# RelayCraft

A powerful, modern web traffic interception and modification tool built with Tauri, React, and Rust.

## Features

- **Real-time Traffic Monitoring**: Capture and inspect HTTP/HTTPS traffic with ease.
- **Rule-based Modification**: Rewrite requests and responses using a flexible rule engine.
- **AI-powered Assistance**: Leverage AI to generate rules, scripts, and analyze traffic.
- **Plugin System**: Extend functionality with a powerful plugin architecture.
- **Scripting Support**: Write custom Python scripts for advanced traffic manipulation.
- **Modern UI**: Clean, intuitive interface with dark mode support.

## Architecture

RelayCraft consists of several components:

- **Frontend**: React-based UI built with Vite and Tailwind CSS.
- **Backend**: Rust-based Tauri application managing system interactions and proxy lifecycle.
- **Engine**: A high-performance proxy engine based on mitmproxy, packaged as a sidecar.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/) (stable)
- [Python](https://www.python.org/) (v3.10+)
- [pnpm](https://pnpm.io/)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/relaycraft.git
   cd relaycraft
   ```

2. Install frontend dependencies:
   ```bash
   pnpm install
   ```

3. (Optional) Build the engine core:
   See [engine-core/README.md](engine-core/README.md) for details.

### Running the App

```bash
pnpm tauri dev
```

## License

[AGPLv3](LICENSE)
