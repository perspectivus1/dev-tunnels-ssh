## Setup
Generate keypair (works with this library and with ssh):
```sh
ssh-keygen -o -t rsa -b 4096 -C "auser" -f id_rsa-exec -m pem
```

Copy the public key to the "server":
```sh
cat ~/.ssh/id_rsa-exec.pub >> ~/.ssh/authorized_keys
```

## Test ssh to localhost
Edit the `/etc/ssh/sshd_config` file to include these lines:
```ini
Port 9880
PubkeyAuthentication yes
AuthorizedKeysFile      .ssh/authorized_keys
```

Restart `sshd`:
```sh
sudo service ssh --full-restart
```

Test the connection:
```sh
ssh localhost -p 9880 -i ./id_rsa-exec
```

## Using this library
Build:
```sh
npm run build-ts
```

Run the server:
```sh
node out/lib/ssh-test/cli.js sshd -p 9881 -o LogLevel=verbose -o AuthorizedKeysFile=/home/auser/.ssh/authorized_keys
```

```sh
node out/lib/ssh-test/cli.js ssh -p 9881 localhost -l auser -o UserKnownHostsFile=/tmp/known_hosts -o IdentityFile=/home/auser/.ssh/id_rsa-exec
```

known_hosts:
```
[localhost]:9881 | AAAAB3NzaC1yc2EAAAADAQABAAABAQDh2knXIhzqwDgXuO2LikzghCELXVcgiePOfC6TsmfDsxXGjDGxGQlveYMJsoDVIgHBVEzq61ZrIr+76d0CxSJRye+E02tfl3+KmyS0N+vXBwjzgjHOS/RNNy4oX9pcpcYaqE4otsimpsmkVZ7It/BnJOeOrAl/mY4K3Kur6znpnqGrwkZDdGx2lAio2jvgd0nkXaxeFT9AnW/2Wt5y3Wv4zej7+6Lzqosrqpu2o0zYhALpUM8sZvFyH2kpnwlcfjKcgYkK8/tGRrIpqUjhVAa7nG/eKRKqYFXSOnertykxqP9h8CNZ4Q10GpU0wE6y91IN9QpoRIA4/SPFz4Ede8Cv
```
---

VS Code launch configurations:

```js
		{
			"type": "node",
			"request": "launch",
			"name": "Launch Node.js server",
			"program": "${workspaceFolder}/out/lib/ssh-test/cli",
			"args": [
				"sshd",
				"-p",
				"9881",
				"-o",
				"AuthorizedKeysFile=/home/auser/.ssh/authorized_keys",
				"-o",
				"LogLevel=verbose"
			],
			"skipFiles": [
				"<node_internals>/**/*.js"
			],
			"env": {
				"DEBUG": "dev-tunnels-ssh"
			},
			"console": "integratedTerminal",
			"sourceMaps": true
		},
		{
			"type": "node",
			"request": "launch",
			"name": "Launch Node.js client",
			"program": "${workspaceFolder}/out/lib/ssh-test/cli",
			"args": [
				"ssh",
				"-p",
				"9881",
				"localhost",
				"-l",
				"auser",
				"-o",
				"UserKnownHostsFile=/tmp/known_hosts",
				"-o",
				"IdentityFile=/home/auser/.ssh/id_rsa.2",
				"ls"
			],
			"skipFiles": [
				"<node_internals>/**/*.js"
			],
			"env": {
				"DEBUG": "dev-tunnels-ssh"
			},
			"console": "integratedTerminal",
			"sourceMaps": true
		},
```