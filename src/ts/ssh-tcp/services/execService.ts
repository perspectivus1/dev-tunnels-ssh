//
//  Copyright (c) Microsoft Corporation. All rights reserved.
//

import {
	SshService,
	SshSession,
	SshChannel,
	SshMessage,
	serviceActivation,
	SshRequestEventArgs,
	SessionRequestMessage,
	SshChannelOpeningEventArgs,
	SshStream,
	SessionRequestFailureMessage,
	SessionRequestSuccessMessage,
	SshChannelOpenFailureReason,
	SshTraceEventIds,
	TraceLevel,
	PromiseCompletionSource,
	ObjectDisposedError,
	CancellationError,
	CancellationToken,
} from '@microsoft/dev-tunnels-ssh';
import { Disposable } from 'vscode-jsonrpc';
import { ForwardedPort } from '../events/forwardedPort';
import { ForwardedPortsCollection } from '../events/forwardedPortsCollection';
import { IPAddressConversions } from '../ipAddressConversions';
import { PortForwardChannelOpenMessage } from '../messages/portForwardChannelOpenMessage';
import { PortForwardRequestMessage } from '../messages/portForwardRequestMessage';
import { PortForwardSuccessMessage } from '../messages/portForwardSuccessMessage';
import { TcpListenerFactory, DefaultTcpListenerFactory } from '../tcpListenerFactory';
import { ChannelForwarder } from './channelForwarder';
import { LocalPortForwarder } from './localPortForwarder';
import { RemotePortConnector } from './remotePortConnector';
import { RemotePortForwarder } from './remotePortForwarder';
import { RemotePortStreamer } from './remotePortStreamer';

/**
 * Implements the standard SSH port-forwarding protocol.
 * @example
 * Use `SshSessionConfiguration.addService()` on both client and server side configurations
 * to add the `ExecService` type before attempting to call methods on the service.
 * Then use `SshSession.activateService()` to get the service instance:
 *
 *     const config = new SshSessionConfiguration();
 *     config.addService(ExecService);
 *     const client = new SshClient(config);
 *     const session = await client.openSession(host, port);
 *     await session.authenticate(clientCredentials);
 *     const pfs = session.activateService(ExecService);
 *     const forwarder = pfs.forwardToRemotePort('::', 3000);
 */
@serviceActivation({ sessionRequest: ExecService.execRequestType })
@serviceActivation({ sessionRequest: ExecService.cancelExecRequestType })
@serviceActivation({ channelType: ExecService.execChannelType })
export class ExecService extends SshService {
	public static readonly execRequestType = 'exec';
	public static readonly cancelExecRequestType = 'cancel-exec';
	public static readonly execChannelType = 'exec';

	/* @internal */
	public constructor(session: SshSession) {
		super(session);
	}

	protected async onSessionRequest(
		request: SshRequestEventArgs<SessionRequestMessage>,
		cancellation?: CancellationToken,
	): Promise<void> {
		if (!request) throw new TypeError('Request is required.');
		else if (
			request.requestType !== ExecService.execRequestType &&
			request.requestType !== ExecService.cancelExecRequestType
		) {
			throw new Error(`Unexpected request type: ${request.requestType}`);
		}

		const portForwardRequest = request.request.convertTo(new PortForwardRequestMessage());
		const localIPAddress = IPAddressConversions.fromSshAddress(portForwardRequest.addressToBind);
		let localPort = portForwardRequest.port;

		const args = new SshRequestEventArgs<SessionRequestMessage>(
			request.requestType,
			portForwardRequest,
			this.session.principal,
		);

		await super.onSessionRequest(args, cancellation);

		let response: SshMessage | undefined;
		if (args.isAuthorized) {
			if (request.requestType === ExecService.execRequestType) {
				let localForwardedPort: number | null;
				try {
					localForwardedPort = await this.startExec(localIPAddress, localPort, cancellation);
				} catch (e) {
					// The error is already traced.
					localForwardedPort = null;
				}
				if (localForwardedPort !== null) {
					const portResponse = new PortForwardSuccessMessage();
					portResponse.port = localForwardedPort;
					response = portResponse;
				}
			} else if (request.requestType === ExecService.cancelExecRequestType) {
				if (await this.cancelExec(localIPAddress, localPort, cancellation)) {
					response = new SessionRequestSuccessMessage();
				}
			}
		}

		request.responsePromise = Promise.resolve(response ?? new SessionRequestFailureMessage());

		// Add to the collection (and raise event) after sending the response,
		// to ensure event-handlers can immediately open a channel.
		if (response instanceof PortForwardSuccessMessage) {
			const forwardedPort = new ForwardedPort(
				response.port,
				portForwardRequest.port === 0 ? null : portForwardRequest.port,
				true,
			);
			// TODO:
			// this.remoteForwardedPorts.addPort(forwardedPort);
		}
	}

	private async startExec(
		localIPAddress: string,
		localPort: number,
		cancellation?: CancellationToken,
	): Promise<number | null> {
		return null;
	}

	private async cancelExec(
		localIPAddress: string,
		localPort: number,
		cancellation?: CancellationToken,
	): Promise<boolean> {
		return true;
	}

	protected async onChannelOpening(
		request: SshChannelOpeningEventArgs,
		cancellation?: CancellationToken,
	): Promise<void> {
		if (!request) throw new TypeError('Request is required.');

		const channelType = request.request.channelType;
		if (channelType !== ExecService.execChannelType) {
			request.failureReason = SshChannelOpenFailureReason.unknownChannelType;
			return;
		}

		if (request.isRemoteRequest) {
			if (channelType !== ExecService.execChannelType) {
				const errorMessage = 'The session has disabled connections to non-forwarded ports.';
				this.session.trace(
					TraceLevel.Warning,
					SshTraceEventIds.portForwardChannelOpenFailed,
					errorMessage,
				);
				request.failureDescription = errorMessage;
				request.failureReason = SshChannelOpenFailureReason.administrativelyProhibited;
				return;
			}
		}

		// TODO:
		const execMessage =
			request.request instanceof PortForwardChannelOpenMessage
				? request.request
				: request.request.convertTo(new PortForwardChannelOpenMessage());

		const portForwardRequest = new SshChannelOpeningEventArgs(
			execMessage,
			request.channel,
			request.isRemoteRequest,
		);
		await super.onChannelOpening(portForwardRequest, cancellation);

		request.failureReason = portForwardRequest.failureReason;
		request.failureDescription = portForwardRequest.failureDescription;
		if (request.failureReason !== SshChannelOpenFailureReason.none || !request.isRemoteRequest) {
			return;
		}
	}

	/* @internal */
	public async openChannel(
		session: SshSession,
		channelType: string,
		originatorIPAddress: string | null,
		originatorPort: number | null,
		host: string,
		port: number,
		cancellation?: CancellationToken,
	): Promise<SshChannel> {
		const openMessage = new PortForwardChannelOpenMessage();
		openMessage.channelType = channelType;
		openMessage.originatorIPAddress = originatorIPAddress ?? '';
		openMessage.originatorPort = originatorPort ?? 0;
		openMessage.host = host;

		const trace = this.session.trace;

		let channel: SshChannel;
		try {
			channel = await session.openChannel(openMessage, null, cancellation);
			trace(
				TraceLevel.Info,
				SshTraceEventIds.portForwardChannelOpened,
				`ExecService opened ${channelType} channel #${channel.channelId} for ${host}:${port}.`,
			);
		} catch (e) {
			if (!(e instanceof Error)) throw e;
			trace(
				TraceLevel.Error,
				SshTraceEventIds.portForwardChannelOpenFailed,
				`ExecService failed to open ${channelType} channel for ${host}:${port}: ${e.message}`,
				e,
			);
			throw e;
		}

		if (channelType === ExecService.execChannelType) {
			// TODO:
			// this.remoteForwardedPorts.addChannel(forwardedPort!, channel);
		}

		return channel;
	}

	public dispose(): void {
		const disposables: Disposable[] = [];

		for (let disposable of disposables) {
			disposable.dispose();
		}

		super.dispose();
	}
}
