# Xray Desktop App: Architecture and Setup Guide

## How It Works (Architecture Overview)

The Xray desktop application uses a multi-language architecture to provide a fast UI while leveraging a powerful Python backend.

1. **The Python Core & Daemon (`xrayd`)**: All protocol logic (HTTP, Redis, DNS, etc.), templating, and assertions live in the Python `core/` package. The core can run as a standalone CLI (`xray`) or as a background API server/daemon (`xrayd`) built with FastAPI.
2. **The Tauri Desktop Shell (Rust)**: The desktop window is managed by Tauri (a lightweight Electron alternative). When the desktop app launches, the Rust sidecar supervisor automatically spawns the `xrayd` Python daemon in the background. It reads a special "handshake" from the daemon (which includes the port and a secure token).
3. **The React UI (TypeScript)**: The frontend is a React application. It receives the handshake details from the Rust shell, and then communicates directly with the Python `xrayd` daemon using HTTP and WebSockets (for live streaming events).

---

## Prerequisites Checklist

To build and run the desktop app on Windows, ALL of the following must be installed:

- [ ] **Node.js (v18+) & NPM**: For the React frontend.
- [ ] **Python (3.11+)**: For the core logic and backend daemon.
- [ ] **C++ Build Tools**: Required by Rust and Tauri to compile windows desktop applications.
- [ ] **Rust Toolchain**: `rustup`, `rustc`, and `cargo` to compile the Tauri backend shell.

---

## Step-by-Step Setup Instructions

### Step 1: Install System Dependencies (Rust & C++)
Because you are on Windows, Tauri requires the Microsoft C++ build tools and the Rust language to compile the desktop window.

1. **Install C++ Build Tools**:
   * Download the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
   * Run the installer, select the **"Desktop development with C++"** workload.
   * On the right panel, ensure "Windows 10/11 SDK" and "C++ CMake tools" are checked, then install.
2. **Install Rust**:
   * Go to [rustup.rs](https://rustup.rs/) and download `rustup-init.exe`.
   * Run it and follow the default prompts (Option 1).
   * **Important:** Restart your computer or terminal after installation to ensure `cargo` and `rustc` are added to your system `PATH`.

### Step 2: Set up the Python Environment (The Daemon)
The desktop app needs to find the `xrayd` executable. During development, it finds this by looking at your current terminal `PATH`.

1. Open a terminal and navigate to the core directory:
   ```powershell
   cd d:\tools-kit\core
   ```
2. Create and activate a virtual environment:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\activate
   ```
3. Install the application in editable mode:
   ```powershell
   pip install -e ".[dev]"
   ```
4. Verify the daemon is accessible:
   ```powershell
   xrayd --help
   ```

### Step 3: Set up the Frontend (React)
1. Open a new terminal (or use the existing one), navigate to the React app folder:
   ```powershell
   cd d:\tools-kit\app
   ```
2. Install the javascript dependencies:
   ```powershell
   npm install
   ```

### Step 4: Run the Application!
Whenever you want to start the app for development, **you must have the Python virtual environment active** so the Rust container can find and start `xrayd`.

1. Open your terminal.
2. Activate the Python virtual environment:
   ```powershell
   cd d:\tools-kit
   .\core\.venv\Scripts\activate
   ```
3. Navigate to the app folder and start Tauri:
   ```powershell
   cd d:\tools-kit\app
   npm run tauri dev
   ```

*Note: The very first time you run `npm run tauri dev`, Cargo (Rust) has to download and compile the entire backend shell framework. This may take a few minutes. Subsequent launches will be exceptionally fast.*
