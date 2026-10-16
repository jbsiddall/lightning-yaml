# Real-world YAML examples

These three files are vendored byte-for-byte from the official repositories and immutable commits listed in `manifest.json`. Their local filenames are the only changes to the sources.

- `kubernetes.yaml`: Kubernetes website nginx Deployment example, licensed CC BY 4.0. Credit: Kubernetes project, [source](https://github.com/kubernetes/website/blob/109572ac97242c9b3d68b4b26afdd22b5f88ed73/content/en/examples/controllers/nginx-deployment.yaml). The complete upstream license is in `licenses/kubernetes-website-LICENSE.txt`.
- `compose.yaml`: Docker Awesome Compose nginx/Flask/MySQL example, licensed CC0 1.0, [source](https://github.com/docker/awesome-compose/blob/30f4b7f6a6c3b0c0ecf4d4efb0de203c48d11562/nginx-flask-mysql/compose.yaml). The complete upstream license is in `licenses/awesome-compose-LICENSE.txt`.
- `github-actions.yaml`: Actions starter-workflows Node.js workflow, licensed MIT, [source](https://github.com/actions/starter-workflows/blob/e3c451d60f119b71caebf13c98ac45da6e15b4b7/ci/node.js.yml). The complete upstream license, including its required copyright and permission notice, is in `licenses/starter-workflows-LICENSE.txt`.

The manifest pins the source and license bytes independently. The Compose example refers to a local secret file but contains no credential value. The workflow keeps the upstream `@v4` action references as written.
