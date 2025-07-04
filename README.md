# WASM Pack Dev Toolchain Action

Installs [wasm-pack](https://github.com/rustwasm/wasm-pack) and [binaryen](https://github.com/WebAssembly/binaryen/tree/main) [wasm-opt](https://github.com/WebAssembly/binaryen/blob/main/src/tools/wasm-opt.cpp) in your GitHub Actions workflows. No more manually managing WebAssembly toolchain downloads.

## What it does

- Downloads and installs wasm-pack and all binaryen tools
- Works on Linux, macOS, and Windows (x86_64 + ARM64)
- Caches tools between runs to keep builds fast
- Automatically adds tools to PATH
- Handles version pinning or uses latest releases

## Tools included

**wasm-pack** - The standard Rust to WebAssembly build tool

**binaryen tools** - Complete WebAssembly optimization suite:
- `wasm-opt` - WebAssembly optimizer (the main one you probably want)
- `wasm-as` - WebAssembly assembler  
- `wasm-dis` - WebAssembly disassembler
- `wasm2js` - WebAssembly to JavaScript compiler
- `wasm-reduce` - Testcase reducer for debugging
- `wasm-shell` - WebAssembly interpreter
- Plus other specialized tools (`wasm-emscripten-finalize`, `wasm-ctor-eval`, etc.)

## Usage

### Basic example

```yaml
- name: Install wasm tools
  uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0

- name: Build WebAssembly
  run: |
    wasm-pack build --target web --release
    wasm-opt --version
```

### Pin specific versions

```yaml
- name: Install specific versions
  uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0
  with:
    binaryen-version:  '118'      # or 'latest'
    wasm-pack-version: '0.13.0'   # or 'latest'
```

## Caching

Tools are cached automatically to avoid re-downloading on every run:

- **First run**: ~30-60 seconds (download + install)
- **Cached runs**: ~5-10 seconds (restore from cache)

Cache keys include OS, architecture, and tool versions, so you'll get a fresh download when versions change but hit the cache otherwise.

Example cache key: `wasm-tools-linux-x86_64-v0.13.0-version_118`

### Cross-platform builds

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    
runs-on: ${{ matrix.os }}
steps:
  - uses: actions/checkout@v4
  - uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0
  - run: |
      wasm-pack --version
      wasm-opt --version
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `wasm-pack-version` | wasm-pack version (`latest` or specific like `0.13.0`) | `latest` |
| `binaryen-version` | binaryen version (`latest` or specific like `118`) | `latest` |

## Platform support

| OS | x86_64 | ARM64 |
|----|--------|-------|
| Linux | ✅ | ✅ |
| macOS | ✅ | ✅ (M1/M2) |
| Windows | ✅ | ❌ |

## Examples

### Rust WASM project with optimization

```yaml
name: Build WASM
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
          
      - name: Cache Rust deps
        uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: rust-${{ hashFiles('**/Cargo.lock') }}
          
      - name: Install WASM tools
        uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0
        
      - name: Build and optimize
        run: |
          wasm-pack build --target web --out-dir pkg
          wasm-opt pkg/my_project_bg.wasm -O3 -o pkg/my_project_bg.wasm
```

### Node.js/TypeScript project with WASM optimization

```yaml
name: Build with WASM optimization
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
          
      - uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0
        
      - name: Build and optimize
        run: |
          npm ci
          npm run build
          # Optimize any .wasm files we generated
          find dist -name "*.wasm" -exec wasm-opt {} -O3 -o {} \;
```

## Troubleshooting

### Tools not in PATH

If `wasm-pack` or `wasm-opt` aren't found after installation:

```yaml
- name: Debug PATH
  run: |
    echo $PATH
    which wasm-pack || echo "wasm-pack not found"
    which wasm-opt || echo "wasm-opt not found"
```

### Force fresh install (bypass cache)

```yaml
- name: Debug with fresh install
  run: echo "cache-bust-$(date +%s)" >> $GITHUB_ENV
- uses: romarketplace-com/wasm-pack-dev-toolchain@v1.0.0
```

Or clear the cache manually in your repo's Actions tab.

### Platform/version issues

The action will list available release assets if it can't find the right download. Check the output and compare with:
- [wasm-pack releases](https://github.com/rustwasm/wasm-pack/releases)
- [binaryen releases](https://github.com/WebAssembly/binaryen/releases)

## Links

- [wasm-pack docs](https://rustwasm.github.io/wasm-pack/)
- [binaryen docs](https://github.com/WebAssembly/binaryen)
- [Rust + WebAssembly book](https://rustwasm.github.io/docs/book/)

## Contributing

PRs welcome. For big changes, open an issue first.

### How to build

This project is built with TypeScript and packaged as a GitHub Action. To set up your development environment:

#### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or later recommended)
- npm (included with Node.js) or [yarn](https://yarnpkg.com/)

#### Setup and build

1. Clone the repository:
   ```bash
   git clone https://github.com/romarketplace-com/wasm-pack-dev-toolchain-installer.git
   cd wasm-pack-dev-toolchain-installer
   ```

2. Install dependencies:
   ```bash
   npm install
   # or
   yarn
   ```

3. Build commands:
   ```bash
   # Compile TypeScript to JavaScript
   npm run build
   # or
   yarn build

   # Format code with Biome
   npm run format:write
   # or
   yarn format:write

   # Lint code
   npm run lint
   # or
   yarn lint:fix

   # Package the action with ncc
   npm run pack
   # or
   yarn pack

   # Run all build steps in sequence
   npm run all
   # or
   yarn all
   ```

4. Testing locally with [act](https://github.com/nektos/act):
   ```bash
   # Install act if you haven't already
   # Then run your action locally
   act -j <job-name>
   ```

#### Project structure

- `src/` - TypeScript source code
  - `index.ts` - Main entry point for the action
  - `dependencies.ts` - Logic for handling tool dependencies, downloads, and setup
- `dist/` - Compiled TypeScript output
- `lib/` - Packaged action code (produced by `npm run pack`)
- `action.yml` - GitHub Action definition
- `example/` - Example Rust WebAssembly project for testing

#### Making changes

1. Make your code changes in the `src/` directory
2. Run `npm run build` to compile TypeScript
3. Run `npm run lint:fix` to ensure code style consistency
4. Run `npm run pack` to package the action using ncc
5. Test your changes locally with act
6. Commit and push your changes

## License

This project is licensed under the **MIT License**, for more information, check the [LICENSE file](./LICENSE).
