import * as core from "@actions/core";
import { WasmPack, Binaryen } from "./dependencies";

// Initialize tools with versions from action inputs
const wasmPack = new WasmPack(core.getInput("wasm-pack-version") || "latest");
const wasmOpt = new Binaryen(core.getInput("binaryen-version") || "latest");

async function run() {
	try {
		// This will trigger the version resolution process including fetching latest if needed
		await wasmPack.ensureProperVersion();
		await wasmOpt.ensureProperVersion();

		// Log the resolved versions (after potential API calls to get latest)
		core.info(`Using wasm-pack version: ${wasmPack.getVersion()}`);
		core.info(`Using wasm-opt version: ${wasmOpt.getVersion()}`);

		// Download and extract the tools
		const wasmPackPath = await wasmPack.download();
		const wasmOptPath = await wasmOpt.download();

		// Add the binary directories to PATH
		core.addPath(wasmPackPath);
		core.addPath(wasmOptPath);

		// Set output variables for use in subsequent steps
		core.setOutput("wasm-pack-path", wasmPackPath);
		core.setOutput("wasm-opt-path", wasmOptPath);
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message);
	}
}

run().catch((error) => {
	core.setFailed(`Action failed with error: ${error.message}`);
});
