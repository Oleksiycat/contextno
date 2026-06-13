import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === "win32";
const nodeBinary = process.execPath;
const nodeDir = path.dirname(process.execPath);
const npmCli = path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js");
const npxCli = path.join(nodeDir, "node_modules", "npm", "bin", "npx-cli.js");
const npmRunner = [nodeBinary, [npmCli]];
const npxRunner = [nodeBinary, [npxCli]];

const services = {
  ai: {
    dir: path.join(rootDir, "services", "ai-service"),
    port: 8001,
    command: [nodeBinary, [npmCli, "start"]],
  },
  backend: {
    dir: path.join(rootDir, "services", "backend"),
    port: 3001,
    command: [nodeBinary, [npmCli, "run", "dev"]],
  },
  frontend: {
    dir: path.join(rootDir, "services", "frontend"),
    port: 3004,
    command: [nodeBinary, [npmCli, "run", "dev", "--", "-p", "3004"]],
  },
};

const children = new Set();

function prismaClientDir() {
  return path.join(services.backend.dir, "src", "generated", "prisma");
}

function log(message) {
  process.stdout.write(`[set] ${message}\n`);
}

function fail(message, error) {
  process.stderr.write(`[set] ${message}\n`);
  if (error) process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exit(1);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[match[1]] = value;
  }

  return env;
}

const serviceEnv = {
  ...process.env,
  ...parseEnvFile(path.join(rootDir, ".env")),
};

function waitForPort(port, timeoutMs = 60000, intervalMs = 500) {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const probe = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });

      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });

      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(probe, intervalMs);
      });
    };

    probe();
  });
}

function openBrowser(url) {
  if (!isWindows) return;

  const child = spawn("cmd.exe", ["/c", "start", "", url], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: options.env || serviceEnv,
    stdio: "inherit",
    shell: options.shell ?? false,
  });

  if (result.error) {
    fail(`Failed to run ${command}.`, result.error);
  }

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function runOptional(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    env: options.env || serviceEnv,
    stdio: options.stdio || "inherit",
    encoding: options.encoding,
    shell: options.shell ?? false,
  });

  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function getWindowsPortOwners(ports) {
  const owners = new Map();
  if (!isWindows) return owners;

  const psPorts = ports.join(",");
  const script = `
$ports = @(${psPorts})
$connections = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
  if ($connection.OwningProcess) {
    Write-Output "$($connection.LocalPort):$($connection.OwningProcess)"
  }
}
`;

  const result = runOptional("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    stdio: "pipe",
    encoding: "utf8",
  });

  if (!result.ok && result.stderr) {
    log(result.stderr.trim());
  }

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+):(\d+)$/);
    if (!match) continue;

    const port = Number(match[1]);
    const pid = Number(match[2]);
    if (!owners.has(port)) owners.set(port, new Set());
    owners.get(port).add(pid);
  }

  return owners;
}

function stopProcessesOnPorts(ports) {
  if (!isWindows) return new Map();

  const owners = getWindowsPortOwners(ports);
  for (const [port, pids] of owners.entries()) {
    for (const pid of pids) {
      if (pid === process.pid) continue;

      log(`Port ${port} is used by PID ${pid}; trying to stop it...`);
      const result = runOptional("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "pipe",
        encoding: "utf8",
      });

      if (!result.ok) {
        const message = (result.stdout || result.stderr || "").trim();
        log(`Could not stop PID ${pid}${message ? `: ${message}` : "."}`);
      }
    }
  }

  return getWindowsPortOwners(ports);
}

function ensureDependencies(serviceName, service) {
  const nodeModules = path.join(service.dir, "node_modules");
  const packageJson = path.join(service.dir, "package.json");

  if (!fs.existsSync(packageJson)) return;

  const needsInstall = !fs.existsSync(nodeModules);

  if (!needsInstall) {
    log(`${serviceName}: dependencies already installed.`);
    return;
  }

  log(`${serviceName}: installing dependencies...`);
  runChecked(npmRunner[0], [...npmRunner[1], "install"], { cwd: service.dir });
}

function cleanPrismaEngineFiles() {
  const clientDir = prismaClientDir();
  if (!fs.existsSync(clientDir)) return;

  for (const entry of fs.readdirSync(clientDir)) {
    if (!/^query_engine-windows\.dll\.node\.tmp.*$/.test(entry)) continue;

    const filePath = path.join(clientDir, entry);
    try {
      fs.rmSync(filePath, { force: true });
      log(`Removed Prisma engine file: ${entry}`);
    } catch {
      log(`Could not remove ${entry}; it may still be locked.`);
    }
  }
}

function hasGeneratedPrismaClient() {
  return fs.existsSync(path.join(prismaClientDir(), "index.js"));
}

function fixPrismaClientPermissions() {
  if (!isWindows) return;

  const clientDir = prismaClientDir();
  if (!fs.existsSync(clientDir)) return;

  const userDomain = process.env.USERDOMAIN;
  const userName = process.env.USERNAME;
  if (!userDomain || !userName) return;

  runOptional("icacls.exe", [clientDir, "/grant", `${userDomain}\\${userName}:(OI)(CI)F`, "/T"]);
}

function preparePrisma() {
  log("Preparing Prisma client...");
  const busyPorts = stopProcessesOnPorts([3001, 3004, 8001]);
  fixPrismaClientPermissions();

  if (busyPorts.has(services.backend.port) && hasGeneratedPrismaClient()) {
    log("Backend is already running, so Prisma DLL is probably locked; using the existing generated client.");
    return busyPorts;
  }

  cleanPrismaEngineFiles();
  runPrismaGenerate();
  return busyPorts;
}

function runPrismaGenerate() {
  const result = spawnSync(npxRunner[0], [...npxRunner[1], "prisma", "generate"], {
    cwd: services.backend.dir,
    env: serviceEnv,
    stdio: "pipe",
    encoding: "utf8",
    shell: false,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error) {
    fail("Failed to run Prisma generate.", result.error);
  }

  if (result.status === 0) return;

  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  const existingClient = path.join(prismaClientDir(), "index.js");
  const isLockedDll = /EPERM|operation not permitted|Access is denied/i.test(output);

  if (isLockedDll && fs.existsSync(existingClient)) {
    log("Prisma client DLL is still locked; continuing with the existing generated client.");
    log("Close the old elevated backend process or run this terminal as administrator to fully regenerate it.");
    return;
  }

  process.exit(result.status || 1);
}

function createPrefixer(name, stream) {
  let pending = "";

  return (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || "";

    for (const line of lines) {
      stream.write(`[${name}] ${line}\n`);
    }
  };
}

function stopChildTree(child) {
  if (!child.pid) return;

  if (isWindows) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      shell: false,
    });
    return;
  }

  child.kill("SIGTERM");
}

function stopAll(exitCode = 0) {
  for (const child of children) stopChildTree(child);
  process.exit(exitCode);
}

function startService(name, service) {
  const [command, args] = service.command;
  const child = spawn(command, args, {
    cwd: service.dir,
    env: serviceEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  children.add(child);
  child.stdout.on("data", createPrefixer(name, process.stdout));
  child.stderr.on("data", createPrefixer(name, process.stderr));

  child.on("error", (error) => {
    fail(`${name} failed to start.`, error);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (signal) {
      log(`${name} stopped by ${signal}.`);
      return;
    }

    if (code && code !== 0) {
      log(`${name} exited with code ${code}; stopping other services.`);
      stopAll(code);
      return;
    }

    log(`${name} stopped.`);
  });

  return child;
}

function main() {
  log("Kontekstno setup/start");

  runChecked("node", ["--version"]);

  for (const [name, service] of Object.entries(services)) {
    ensureDependencies(name, service);
  }

  let busyPorts = preparePrisma();
  busyPorts = getWindowsPortOwners([3001, 3004, 8001]);

  log("Starting services:");
  log("AI       http://localhost:8001");
  log("Backend  http://localhost:3001");
  log("Frontend http://localhost:3004");
  log("Press Ctrl+C to stop all services.");

  for (const [name, service] of Object.entries(services)) {
    const owners = busyPorts.get(service.port);
    if (owners?.size) {
      log(`${name}: port ${service.port} is already used by PID(s) ${[...owners].join(", ")}; leaving it running.`);
      continue;
    }

    startService(name, service);
  }

  waitForPort(services.frontend.port).then((ready) => {
    if (!ready) {
      log(`Frontend did not become ready on port ${services.frontend.port}.`);
      return;
    }

    const url = `http://localhost:${services.frontend.port}`;
    log(`Opening ${url}`);
    openBrowser(url);
  });
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

main();
