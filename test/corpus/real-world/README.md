# Real-world YAML examples

These files are vendored byte-for-byte from the official repositories and immutable commits listed in `manifest.json`. Their local filenames are the only changes to the source files. The manifest pins source and license bytes independently; complete license copies are in `licenses/`.

- `kubernetes.yaml`: Kubernetes website nginx Deployment example, licensed CC BY 4.0. Credit: Kubernetes project, [source](https://github.com/kubernetes/website/blob/109572ac97242c9b3d68b4b26afdd22b5f88ed73/content/en/examples/controllers/nginx-deployment.yaml).
- `kubernetes-zookeeper.yaml`: Kubernetes website four-document ZooKeeper stream, licensed CC BY 4.0. Credit: Kubernetes project, [source](https://github.com/kubernetes/website/blob/109572ac97242c9b3d68b4b26afdd22b5f88ed73/content/en/examples/application/zookeeper/zookeeper.yaml).
- `compose.yaml`: Docker Awesome Compose nginx/Flask/MySQL example, licensed CC0 1.0, [source](https://github.com/docker/awesome-compose/blob/30f4b7f6a6c3b0c0ecf4d4efb0de203c48d11562/nginx-flask-mysql/compose.yaml).
- `compose-pihole-cloudflared.yaml`: Docker Awesome Compose Pi-hole and Cloudflared example, licensed CC0 1.0, [source](https://github.com/docker/awesome-compose/blob/30f4b7f6a6c3b0c0ecf4d4efb0de203c48d11562/pihole-cloudflared-DoH/compose.yaml). Its `${...}` values are interpolation references; no `.env` file or credential values are included.
- `github-actions.yaml`: Actions starter-workflows Node.js workflow, licensed MIT, [source](https://github.com/actions/starter-workflows/blob/e3c451d60f119b71caebf13c98ac45da6e15b4b7/ci/node.js.yml).
- `github-actions-cmake-multi-platform.yml`: Actions starter-workflows CMake multi-platform workflow, licensed MIT, [source](https://github.com/actions/starter-workflows/blob/e3c451d60f119b71caebf13c98ac45da6e15b4b7/ci/cmake-multi-platform.yml). It preserves the plain `on` key and GitHub expression scalars exactly as upstream.

The manifest records source repository, immutable commit, path, byte length, SHA-256, license identifier, upstream license path, and the separately vendored license byte length and SHA-256. The entries cover Kubernetes, Docker Compose, and GitHub Actions configuration shapes; they are bounded test inputs, not an estimate of all YAML used in those ecosystems.
