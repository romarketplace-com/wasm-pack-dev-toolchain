import * as core from "@actions/core";
import * as io from "@actions/io";
import * as tc from "@actions/tool-cache";
import * as os from "node:os";
import * as path from "node:path";
import * as client from "typed-rest-client/HttpClient";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

enum ArchiveType {
	GZ = ".tar.gz",
	ZIP = ".zip",
	EXE = ".exe",
}

/* wasm-pack and binaryen use different names for their archives, so we need to handle them separately.
 binaryen uses `x86_64-windows` for windows:
    binaryen-version_123-aarch64-linux.tar.gz
    binaryen-version_123-aarch64-linux.tar.gz.sha256
    binaryen-version_123-arm64-macos.tar.gz
    binaryen-version_123-arm64-macos.tar.gz.sha256
    binaryen-version_123-node.tar.gz
    binaryen-version_123-node.tar.gz.sha256
    binaryen-version_123-x86_64-linux.tar.gz
    binaryen-version_123-x86_64-linux.tar.gz.sha256
    binaryen-version_123-x86_64-macos.tar.gz
    binaryen-version_123-x86_64-macos.tar.gz.sha256
    binaryen-version_123-x86_64-windows.tar.gz
    binaryen-version_123-x86_64-windows.tar.gz.sha256
wasm-pack uses `x86_64-pc-windows-msvc` for windows:
    wasm-pack-init.exe
    wasm-pack-v0.13.1-aarch64-unknown-linux-musl.tar.gz
    wasm-pack-v0.13.1-x86_64-apple-darwin.tar.gz
    wasm-pack-v0.13.1-x86_64-pc-windows-msvc.tar.gz
    wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz
*/
/**
 * Represents a dependency that can be downloaded from GitHub.
 * This class provides methods to manage the dependency's version and download it if necessary.
 * It uses the GitHub API to fetch the latest version of the dependency.
 * @constructor
 * @param {string} repo - The repository name in the format 'owner/repo'.
 * @param {string} [version] - The version of the dependency to be used. If not provided, it defaults to the latest version, which is fetched from the GitHub API.
 * @example
 * const Dependency = new Dependency('owner/repo', 'v1.0.0');
 * const version = await Dependency.getVersion(); // Returns 'v1.0.0'
 * @example
 * const dependency = new Dependency('owner/repo');
 * const version = await dependency.getVersion(); // Returns the latest version, e.g., 'v1.2.3'
 */
export class Dependency {
	static httpClient: client.HttpClient = new client.HttpClient(
		"wasm-pack-dev-toolchain",
		[],
		{
			// Set custom headers for GitHub API, including User-Agent
			headers: {
				"User-Agent": "wasm-pack-dev-toolchain GitHub Action",
				Accept: "application/vnd.github.v3+json",
			},
		},
	);
	protected repo: string;
	protected version?: string;

	/**
	 * Creates an instance of the Library class.
	 * @param repo - The repository name in the format 'owner/repo'.
	 * @param version - The version of the library to be used.
	 */
	constructor(repo: string, version?: string) {
		this.repo = repo;
		// Store the original version
		this.version = version || "latest";
	}

	/**
	 * Used internally to construct the API URL for the GitHub repository.
	 * This method appends the specified endpoint to the base URL of the GitHub API for the repository.
	 * @param endpoint - The API endpoint to be appended to the base URL.
	 *                   For example, 'releases/latest' to get the latest release.
	 * @returns The full API URL as a string.
	 */
	protected getApiUrl(endpoint: string): string {
		return `https://api.github.com/repos/${this.repo}/${endpoint}`;
	}

	protected getArchiveName(
		archiveType: ArchiveType = ArchiveType.GZ,
	): string | undefined {
		const platform = process.env.PLATFORM || process.platform;
		core.debug(platform);

		let ext = "";
		let arch = "";
		switch (platform) {
			case "win32":
				ext = ".exe";
				arch = "x86_64-pc-windows-msvc";
				break;
			case "darwin":
				arch = "x86_64-apple-darwin";
				break;
			case "linux":
				arch = "x86_64-unknown-linux-musl";
				break;
			default:
				core.setFailed(`Unsupported platform: ${platform}`);
				return;
		}
		if (archiveType === ArchiveType.ZIP) {
			return `${this.version}.zip`;
		}
		const repoName = this.repo.split("/")[1];
		return `${repoName}-${this.version}-${arch}${ext}`;
	}

	protected getDownloadUrl(archiveType: ArchiveType = ArchiveType.GZ): string {
		// get the archive name based on the OS
		const archiveName = this.getArchiveName(archiveType);
		if (archiveType === ArchiveType.ZIP) {
			return `https://github.com/${this.repo}/archive/refs/tags/${archiveName}`;
		}
		core.info(`Using archive name: ${archiveName}`);
		return `https://github.com/${this.repo}/releases/download/${this.version}/${archiveName}`;
	}

	/**
	 * Retrieves the latest version of the library from GitHub.
	 * @returns The latest version as a string.
	 * @throws Error if the request fails or the response cannot be parsed
	 */
	protected async getLatestVersion(): Promise<string> {
		try {
			core.debug(
				`Fetching latest release from ${this.getApiUrl("releases/latest")}`,
			);

			const response = await Dependency.httpClient.get(
				this.getApiUrl("releases/latest"),
			);

			// Check for successful response
			if (response.message.statusCode !== 200) {
				throw new Error(
					`Failed to get latest release, status code: ${response.message.statusCode}`,
				);
			}

			const body = await response.readBody();
			const releaseInfo = JSON.parse(body);

			if (!releaseInfo.tag_name) {
				throw new Error(
					`No tag_name found in GitHub API response for ${this.repo}`,
				);
			}

			core.debug(
				`Latest release tag for ${this.repo}: ${releaseInfo.tag_name}`,
			);
			return releaseInfo.tag_name;
		} catch (error) {
			throw new Error(
				`Failed to fetch latest version for ${this.repo}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	/**
	 * Gets the version of the library.
	 * @returns A promise that resolves to the version string, or undefined if not set.
	 *          If the version is not set, it will default to the latest version.
	 */
	async getVersion(): Promise<string | undefined> {
		if (this.version === "latest") {
			return this.getLatestVersion();
		}
		return this.version;
	}

	/**
	 * Find the actual binary directory within the extracted folder.
	 * This method scans the extracted directory to find the actual executable.
	 * @param extractedPath - The path where the archive was extracted
	 * @returns The path to the directory containing the binary
	 */
	protected findBinaryPath(extractedPath: string): string {
		const toolName = this.repo.split("/")[1];
		const platform = process.platform;
		const isWindows = platform === "win32";
		const binFileName = isWindows ? `${toolName}.exe` : toolName;

		// First, check if the binary exists directly in the extractedPath
		const directPath = path.join(extractedPath, binFileName);
		if (fs.existsSync(directPath)) {
			core.info(`Found binary at: ${directPath}`);
			return extractedPath;
		}

		// Check common locations
		const commonDirs = [
			"bin", // Common binary directory
			".", // Root directory
		];

		for (const dir of commonDirs) {
			const binPath = path.join(extractedPath, dir, binFileName);
			if (fs.existsSync(binPath)) {
				core.info(`Found binary at: ${binPath}`);
				return path.join(extractedPath, dir);
			}
		}

		// If not found in common locations, search recursively up to 2 levels deep
		core.info(`Searching recursively for ${binFileName} in ${extractedPath}`);
		try {
			const dirs = fs.readdirSync(extractedPath);
			for (const dir of dirs) {
				const fullPath = path.join(extractedPath, dir);
				if (fs.statSync(fullPath).isDirectory()) {
					// Check if binary exists in this directory
					const binPath = path.join(fullPath, binFileName);
					if (fs.existsSync(binPath)) {
						core.info(`Found binary at: ${binPath}`);
						return fullPath;
					}

					// Check one level deeper
					try {
						const subDirs = fs.readdirSync(fullPath);
						for (const subDir of subDirs) {
							const subFullPath = path.join(fullPath, subDir);
							if (fs.statSync(subFullPath).isDirectory()) {
								const subBinPath = path.join(subFullPath, binFileName);
								if (fs.existsSync(subBinPath)) {
									core.info(`Found binary at: ${subBinPath}`);
									return subFullPath;
								}
							}
						}
					} catch (err) {
						// Skip errors reading subdirectories
						core.debug(`Error reading subdirectory ${fullPath}: ${err}`);
					}
				}
			}
		} catch (err) {
			core.warning(`Error searching for binary in ${extractedPath}: ${err}`);
		}

		// If we couldn't find the binary, return the original path and log a warning
		core.warning(
			`Could not find ${binFileName} in ${extractedPath}. Using extractedPath.`,
		);
		return extractedPath;
	}

	/**
	 * Downloads the library from GitHub and caches it.
	 * If the version is not specified, it defaults to the latest version.
	 * @return A promise that resolves to the path of the downloaded tool.
	 *         If the tool is already cached, it returns the cached path.
	 * @throws {Error} If the download fails or the version is not set.
	 */
	/**
	 * Ensures the version is properly formatted for the specific dependency.
	 * This method is meant to be overridden by subclasses to handle their specific versioning formats.
	 */
	async ensureProperVersion(): Promise<string> {
		if (this.version === "latest") {
			try {
				const latestVersion = await this.getLatestVersion();
				core.info(`Using latest version: ${latestVersion}`);
				this.version = latestVersion;
			} catch (error) {
				core.warning(
					`Failed to get latest version: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				// Keep using "latest" - subclasses can handle this
			}
		}

		return this.version as string;
	}

	async download(): Promise<string> {
		// Ensure we have the proper version format
		await this.ensureProperVersion();

		const url = this.getDownloadUrl();
		core.info(`Downloading ${this.repo} from ${url} to cache`);

		const toolName = this.repo.split("/")[1];
		// Make sure we have a valid version string for caching
		const versionForCache = this.version || "unknown";
		const cachedPath = tc.find(toolName, versionForCache);

		if (cachedPath) {
			core.info(`Found cached ${toolName} at ${cachedPath}`);
			// Find the binary path within the cached directory
			const binaryPath = this.findBinaryPath(cachedPath);
			core.info(`Using binary directory: ${binaryPath}`);
			return Promise.resolve(binaryPath);
		}

		try {
			core.info(`No cached version found for ${toolName}, downloading...`);

			const downloadPath = await tc.downloadTool(url);
			core.info(`Downloaded ${toolName} to ${downloadPath}`);

			// Log file information to help diagnose issues
			try {
				const stats = fs.statSync(downloadPath);
				core.info(`Downloaded file size: ${stats.size} bytes`);

				// Check if file is empty
				if (stats.size === 0) {
					throw new Error("Downloaded file is empty");
				}

				// Check file content to help diagnose issues
				const buffer = Buffer.alloc(Math.min(stats.size, 16));
				const fd = fs.openSync(downloadPath, "r");
				fs.readSync(fd, buffer, 0, buffer.length, 0);
				fs.closeSync(fd);

				core.info(`File header (hex): ${buffer.toString("hex")}`);
			} catch (fileError) {
				core.warning(`Error examining downloaded file: ${fileError}`);
				// Continue with extraction attempt anyway
			}

			// Extract based on file type
			const extractedPath = await this.extractTool(downloadPath);
			core.info(`Extracted ${toolName} to ${extractedPath}`);

			// Find the binary path within the extracted directory
			const binaryPath = this.findBinaryPath(extractedPath);
			core.info(`Found binary directory: ${binaryPath}`);

			// Cache the extracted tool
			const cachedToolPath = await tc.cacheDir(
				extractedPath,
				toolName,
				versionForCache,
				os.arch(),
			);

			// Return the binary path with the cached path as base
			const relativePath = path.relative(extractedPath, binaryPath);
			const cachedBinaryPath = path.join(cachedToolPath, relativePath);

			core.info(`Cached ${toolName} to ${cachedToolPath}`);
			core.info(`Binary path: ${cachedBinaryPath}`);

			return Promise.resolve(cachedBinaryPath);
		} catch (error) {
			throw new Error(
				`Failed to download or extract ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	protected async extractTool(downloadPath: string): Promise<string> {
		const platform = process.platform;
		let extractedPath: string = "";

		try {
			// Check for known extensions
			if (downloadPath.endsWith(".zip")) {
				extractedPath = await tc.extractZip(downloadPath);
			} else if (downloadPath.endsWith(".tar.gz")) {
				extractedPath = await tc.extractTar(downloadPath);
			} else if (downloadPath.endsWith(".exe")) {
				// For .exe files, we just need to make it executable
				const destDir = path.join(
					os.tmpdir(),
					"wasm-pack-dev-toolchain",
					`${Date.now()}`,
				);
				await io.mkdirP(destDir);
				const destPath = path.join(destDir, path.basename(downloadPath));
				await io.cp(downloadPath, destPath);

				// Make the file executable
				if (platform !== "win32") {
					// Use fs to set the permissions
					fs.chmodSync(destPath, "755");
				}

				return destDir;
			} else {
				// Try to detect the file type based on content
				core.info(`File doesn't have a recognized extension: ${downloadPath}`);

				// Try to read first few bytes to detect file type
				const header = Buffer.alloc(4);
				const fd = fs.openSync(downloadPath, "r");
				fs.readSync(fd, header, 0, 4, 0);
				fs.closeSync(fd);

				// Check for gzip magic number (1F 8B)
				if (header[0] === 0x1f && header[1] === 0x8b) {
					core.info("Detected gzip compressed file");
					// If gzipped, assume tar.gz and extract
					extractedPath = await tc.extractTar(downloadPath);
				} else if (header[0] === 0x50 && header[1] === 0x4b) {
					core.info("Detected zip file");
					// If zip magic number (PK), extract as zip
					extractedPath = await tc.extractZip(downloadPath);
				} else {
					// For other files, we'll try tar as a fallback with compression flags
					core.info(
						"Trying to extract as tar.gz as fallback with explicit compression detection",
					);
					try {
						core.info("Trying xz extraction...");
						extractedPath = await tc.extractTar(downloadPath, undefined, "xz");
					} catch (_) {
						try {
							core.info("Trying gz extraction...");
							extractedPath = await tc.extractTar(
								downloadPath,
								undefined,
								"gz",
							);
						} catch (_) {
							try {
								core.info("Trying default extraction...");
								extractedPath = await tc.extractTar(
									downloadPath,
									undefined,
									undefined,
								);
							} catch (tarErr) {
								throw new Error(
									`Unable to extract archive using any method: ${tarErr}`,
								);
							}
						}
					}
				}
			}

			return extractedPath;
		} catch (err) {
			// Add more diagnostic info to the error
			const fileSize = fs.statSync(downloadPath).size;
			core.info(`Failed to extract file. Size: ${fileSize} bytes`);

			if (fileSize === 0) {
				throw new Error(`Downloaded file is empty: ${downloadPath}`);
			}

			throw new Error(
				`Error extracting ${downloadPath}: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}
}

export class WasmPack extends Dependency {
	constructor(version?: string) {
		super("rustwasm/wasm-pack", version);
	}

	override getArchiveName(
		archiveType: ArchiveType = ArchiveType.GZ,
	): string | undefined {
		const platform = process.env.PLATFORM || process.platform;
		core.debug(platform);

		let arch = "";
		switch (platform) {
			case "win32":
				return `wasm-pack-init.exe`;
			case "darwin":
				arch = "x86_64-apple-darwin";
				break;
			case "linux":
				arch = "x86_64-unknown-linux-musl";
				break;
			default:
				core.setFailed(`Unsupported platform: ${platform}`);
				return;
		}
		if (archiveType === ArchiveType.ZIP) {
			return `${this.version}.zip`;
		}
		return `wasm-pack-${this.version}-${arch}${ArchiveType.GZ}`;
	}

	/**
	 * Ensures the version is properly formatted for wasm-pack
	 * wasm-pack uses version strings with v prefix (e.g., v0.13.1)
	 */
	async ensureProperVersion(): Promise<string> {
		// Try to get the latest version if specified
		if (this.version === "latest") {
			try {
				const latestVersion = await this.getLatestVersion();
				core.info(`Using latest wasm-pack version: ${latestVersion}`);
				this.version = latestVersion;
			} catch (error) {
				core.warning(
					`Failed to fetch latest wasm-pack version: ${error instanceof Error ? error.message : String(error)}`,
				);
				core.info("Falling back to known stable version v0.13.1");
				this.version = "v0.13.1";
			}
		}

		// Make sure version has "v" prefix for wasm-pack
		if (this.version && !this.version.startsWith("v")) {
			this.version = `v${this.version}`;
		}

		return this.version as string;
	}

	override getDownloadUrl(archiveType: ArchiveType = ArchiveType.GZ): string {
		const archiveName = this.getArchiveName(archiveType);
		core.info(`Using archive name: ${archiveName}`);
		return `https://github.com/${this.repo}/releases/download/${this.version}/${archiveName}`;
	}

	override findBinaryPath(extractedPath: string): string {
		const platform = process.platform;
		const isWindows = platform === "win32";
		const binFileName = isWindows ? "wasm-pack.exe" : "wasm-pack";

		// Specific structure for wasm-pack: check for a direct binary and for a bin directory
		const directPath = path.join(extractedPath, binFileName);
		if (fs.existsSync(directPath)) {
			core.info(`Found wasm-pack binary at: ${directPath}`);
			return extractedPath;
		}

		// Check common wasm-pack binary locations
		const possiblePaths = [
			path.join(extractedPath, "bin", binFileName), // Linux/macOS common location
			path.join(extractedPath, "wasm-pack", "bin", binFileName), // Some distributions may have this structure
		];

		for (const binPath of possiblePaths) {
			if (fs.existsSync(binPath)) {
				const binDir = path.dirname(binPath);
				core.info(`Found wasm-pack binary at: ${binPath}`);
				return binDir;
			}
		}

		// Use fallback recursive search
		return super.findBinaryPath(extractedPath);
	}

	async download(): Promise<string> {
		// Ensure we have the proper version format before trying to download
		await this.ensureProperVersion();

		const url = this.getDownloadUrl(ArchiveType.GZ);
		core.info(`Downloading wasm-pack from ${url}`);

		try {
			// Use specific extraction flags for wasm-pack
			return await super.download();
		} catch (error) {
			// If the standard extraction fails, try using the tar command directly
			core.warning(
				`Standard extraction failed: ${error instanceof Error ? error.message : String(error)}`,
			);

			try {
				const toolName = this.repo.split("/")[1];
				const versionForCache = this.version || "unknown";

				// Download the file again
				const downloadPath = await tc.downloadTool(url);
				core.info(`Re-downloaded wasm-pack to ${downloadPath}`);

				// Create temp extraction directory
				const extractDir = path.join(
					os.tmpdir(),
					`wasm-pack-extract-${Date.now()}`,
				);
				await io.mkdirP(extractDir);

				// Try to use the tar command directly on Linux/macOS
				if (process.platform !== "win32") {
					core.info(`Extracting with system tar command to ${extractDir}`);

					try {
						execSync(`tar -xzf "${downloadPath}" -C "${extractDir}"`);

						// Find binary path in the extracted directory
						const binaryPath = this.findBinaryPath(extractDir);
						core.info(`Found binary directory with system tar: ${binaryPath}`);

						// Cache the extracted tool
						const cachedToolPath = await tc.cacheDir(
							extractDir,
							toolName,
							versionForCache,
							os.arch(),
						);

						// Calculate the relative path from extract dir to binary path
						const relativePath = path.relative(extractDir, binaryPath);
						const cachedBinaryPath = path.join(cachedToolPath, relativePath);

						core.info(
							`Cached ${toolName} to ${cachedToolPath} using system tar`,
						);
						core.info(`Binary path: ${cachedBinaryPath}`);
						return Promise.resolve(cachedBinaryPath);
					} catch (tarError) {
						throw new Error(
							`Failed to extract with system tar: ${tarError instanceof Error ? tarError.message : String(tarError)}`,
						);
					}
				} else {
					// On Windows we need different extraction methods
					throw new Error("Standard extraction failed on Windows");
				}
			} catch (fallbackError) {
				throw new Error(
					`All extraction methods failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
				);
			}
		}
	}
}

export class Binaryen extends Dependency {
	constructor(version?: string) {
		super("WebAssembly/binaryen", version);
	}

	/**
	 * Extracts the version number from Binaryen release tag format.
	 * Binaryen releases use the format "version_123" or similar.
	 * @param releaseTag The release tag from GitHub
	 * @returns The cleaned version string in binaryen format (e.g., "version_123")
	 */
	private formatBinaryenVersion(releaseTag: string): string {
		// Check if it already has the correct format
		if (releaseTag.startsWith("version_")) {
			return releaseTag;
		}

		// If it's a raw number, prefix with "version_"
		const numValue = Number(releaseTag);
		if (!Number.isNaN(numValue)) {
			return `version_${releaseTag}`;
		}

		// If it has a "v" prefix and then a number, convert to version_X format
		if (releaseTag.startsWith("v")) {
			const versionNumber = Number(releaseTag.substring(1));
			if (!Number.isNaN(versionNumber)) {
				return `version_${releaseTag.substring(1)}`;
			}
		}

		// Otherwise, extract numeric part and format
		const match = releaseTag.match(/(\d+)/);
		if (match !== null && match.length > 1) {
			return `version_${match[1]}`;
		}

		// Default fallback
		core.warning(
			`Could not parse Binaryen version from ${releaseTag}, using as is`,
		);
		return releaseTag;
	}

	/**
	 * Ensures the version is properly formatted for Binaryen
	 * Binaryen uses version strings with "version_" prefix (e.g., version_118)
	 */
	async ensureProperVersion(): Promise<string> {
		// Try to get the latest version if specified
		if (this.version === "latest") {
			try {
				const latestVersion = await this.getLatestVersion();
				core.info(`Using latest binaryen version: ${latestVersion}`);
				this.version = this.formatBinaryenVersion(latestVersion);
			} catch (error) {
				core.warning(
					`Failed to fetch latest binaryen version: ${error instanceof Error ? error.message : String(error)}`,
				);
				core.info("Falling back to known stable version version_118");
				this.version = "version_118";
			}
		}
		// If a version is specified but not in the right format, format it
		else if (this.version && !this.version.startsWith("version_")) {
			this.version = this.formatBinaryenVersion(this.version);
		}

		return this.version as string;
	}

	override getDownloadUrl(archiveType: ArchiveType = ArchiveType.GZ): string {
		const archiveName = this.getArchiveName(archiveType);
		core.info(`Using archive name: ${archiveName}`);
		return `https://github.com/${this.repo}/releases/download/${this.version}/${archiveName}`;
	}

	override getArchiveName(
		archiveType: ArchiveType = ArchiveType.GZ,
	): string | undefined {
		const platform = process.env.PLATFORM || process.platform;
		core.debug(platform);
		const ext = ".tar.gz";
		let arch = "";

		switch (platform) {
			case "win32":
				arch = "x86_64-windows";
				break;
			case "darwin":
				if (os.arch() === "arm64") {
					arch = "arm64-macos";
				} else {
					arch = "x86_64-macos";
				}
				break;
			case "linux":
				if (os.arch() === "arm64") {
					arch = "aarch64-linux";
				} else {
					arch = "x86_64-linux";
				}
				break;
			default:
				core.setFailed(`Unsupported platform: ${platform}`);
				return;
		}

		if (archiveType === ArchiveType.ZIP) {
			return `${this.version}.zip`;
		}

		// Binaryen uses different naming convention: binaryen-version_123-x86_64-linux.tar.gz
		return `binaryen-${this.version}-${arch}${ext}`;
	}

	override findBinaryPath(extractedPath: string): string {
		const platform = process.platform;
		const isWindows = platform === "win32";
		const binFileName = isWindows ? "wasm-opt.exe" : "wasm-opt";

		// Binaryen extracts with a nested directory structure like binaryen-version_118/
		// First check if we're already in a bin directory
		const directPath = path.join(extractedPath, binFileName);
		if (fs.existsSync(directPath)) {
			core.info(`Found wasm-opt binary at: ${directPath}`);
			return extractedPath;
		}

		// Check for a bin directory at the root level
		const binPath = path.join(extractedPath, "bin", binFileName);
		if (fs.existsSync(binPath)) {
			core.info(`Found wasm-opt binary at: ${binPath}`);
			return path.join(extractedPath, "bin");
		}

		// Check subdirectories for binaryen-version_X structure
		try {
			const dirs = fs.readdirSync(extractedPath);
			for (const dir of dirs) {
				if (dir.startsWith("binaryen-")) {
					const versionDir = path.join(extractedPath, dir);
					if (fs.statSync(versionDir).isDirectory()) {
						// Check for binary directly in version directory
						const versionBinPath = path.join(versionDir, binFileName);
						if (fs.existsSync(versionBinPath)) {
							core.info(`Found wasm-opt binary at: ${versionBinPath}`);
							return versionDir;
						}

						// Check for bin directory in version directory
						const versionBinDirPath = path.join(versionDir, "bin", binFileName);
						if (fs.existsSync(versionBinDirPath)) {
							core.info(`Found wasm-opt binary at: ${versionBinDirPath}`);
							return path.join(versionDir, "bin");
						}
					}
				}
			}
		} catch (err) {
			core.warning(`Error searching in Binaryen directory: ${err}`);
		}

		// Use fallback recursive search
		return super.findBinaryPath(extractedPath);
	}

	async download(): Promise<string> {
		// Ensure we have the proper version format before trying to download
		await this.ensureProperVersion();

		const url = this.getDownloadUrl();
		core.info(`Downloading binaryen from ${url}`);

		return super.download();
	}
}
