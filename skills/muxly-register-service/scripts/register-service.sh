#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  register-service.sh --stdin [--replace]
  register-service.sh --service-json '{...}' [--replace]
  register-service.sh --id ID --name NAME --program PROGRAM --cwd CWD [options]

Options:
  --arg VALUE           Add one argument. Repeat for multiple args.
  --args "run dev"      Split a simple whitespace-separated args string.
  --env KEY=VALUE       Add one environment variable. Repeat for multiple env vars.
  --port PORT           Service port. Must be 1-65535.
  --group GROUP         Service group.
  --icon-json '{...}'   Service icon object.
  --auto-restart        Set autoRestart true.
  --replace             Replace an existing service with the same id.
  --config PATH         Override services.json path.
  --print-path          Print the detected services.json path and exit.
USAGE
}

replace=false
stdin=false
print_path=false
service_json=""
config_path=""

declare -a passthrough=()

while (($#)); do
  case "$1" in
    --stdin) stdin=true; shift ;;
    --replace) replace=true; shift ;;
    --print-path) print_path=true; shift ;;
    --service-json|--config|--id|--name|--program|--cwd|--args|--arg|--env|--port|--group|--icon-json)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 2
      fi
      if [[ "$1" == "--service-json" ]]; then service_json="$2"; fi
      if [[ "$1" == "--config" ]]; then config_path="$2"; fi
      passthrough+=("$1" "$2")
      shift 2
      ;;
    --auto-restart)
      passthrough+=("$1")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to update services.json safely." >&2
  exit 1
fi

export MUXLY_REGISTER_REPLACE="$replace"
export MUXLY_REGISTER_STDIN="$stdin"
export MUXLY_REGISTER_PRINT_PATH="$print_path"
export MUXLY_REGISTER_SERVICE_JSON="$service_json"
export MUXLY_REGISTER_CONFIG_PATH="$config_path"

# Write the program to a temp file and run it, rather than `node - <<'NODE'`:
# with `node -` the heredoc becomes node's stdin (the program source), so piped
# `--stdin` JSON would never reach readStdin(). A temp file leaves the script's
# stdin connected to the caller's pipe. (Process substitution `<(...)` would
# also work on Linux/macOS but breaks under Windows Git Bash + native node,
# where /dev/fd paths are mangled.) `.cjs` forces CommonJS regardless of any
# ambient package.json.
node_prog_dir="$(mktemp -d "${TMPDIR:-/tmp}/muxly-register.XXXXXX")"
trap 'rm -rf "$node_prog_dir"' EXIT
node_prog="$node_prog_dir/register.cjs"
cat > "$node_prog" <<'NODE'
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function defaultConfigPath() {
  const appId = 'com.diethos.muxly';
  if (process.env.MUXLY_REGISTER_CONFIG_PATH) return process.env.MUXLY_REGISTER_CONFIG_PATH;
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, appId, 'services.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', appId, 'services.json');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, appId, 'services.json');
}

function parseFlags(args) {
  const service = { args: [], env: {} };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '--service-json':
      case '--config':
        i++;
        break;
      case '--id':
        service.id = value; i++; break;
      case '--name':
        service.name = value; i++; break;
      case '--program':
        service.program = value; i++; break;
      case '--cwd':
        service.cwd = value; i++; break;
      case '--args':
        service.args.push(...String(value).trim().split(/\s+/).filter(Boolean)); i++; break;
      case '--arg':
        service.args.push(value); i++; break;
      case '--env': {
        const index = String(value).indexOf('=');
        if (index <= 0) throw new Error('--env must be KEY=VALUE');
        service.env[String(value).slice(0, index)] = String(value).slice(index + 1);
        i++;
        break;
      }
      case '--port': {
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535');
        service.port = port;
        i++;
        break;
      }
      case '--group':
        service.group = value; i++; break;
      case '--icon-json':
        service.icon = JSON.parse(value); i++; break;
      case '--auto-restart':
        service.autoRestart = true; break;
      default:
        throw new Error(`Unknown argument passed to Node helper: ${flag}`);
    }
  }
  if (!('autoRestart' in service)) service.autoRestart = false;
  return service;
}

// Coerce a JSON value to a real boolean. Muxly's serde fields (usePty,
// autoPort, sensitive, autoRestart) are typed `bool`, so a stringified
// "true"/"false" — a realistic LLM slip — makes serde drop the whole entry
// silently. Accept the common string/number forms and normalize. Keep this in
// sync with Register-Service.ps1's Coerce-Bool.
function coerceBool(value, field) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0' || lower === '') return false;
  }
  if (value === 1) return true;
  if (value === 0) return false;
  throw new Error(`Service field ${field} must be a boolean`);
}

function normalizeService(service) {
  for (const field of ['id', 'name', 'program', 'cwd']) {
    if (typeof service[field] !== 'string' || service[field].trim() === '') {
      throw new Error(`Service field ${field} is required`);
    }
    service[field] = service[field].trim();
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(service.id)) {
    throw new Error('Service field id may only contain letters, numbers, dot, underscore, and hyphen');
  }
  if (service.args == null) service.args = [];
  if (!Array.isArray(service.args) || service.args.some(arg => typeof arg !== 'string')) {
    throw new Error('Service field args must be an array of strings');
  }
  if (service.env == null) service.env = {};
  if (typeof service.env !== 'object' || Array.isArray(service.env)) {
    throw new Error('Service field env must be an object');
  }
  for (const [key, value] of Object.entries(service.env)) {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new Error('Service field env must be an object of string values');
    }
  }
  if (service.port != null) {
    const port = Number(service.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Service field port must be an integer from 1 to 65535');
    service.port = port;
  }
  if (service.group != null && typeof service.group !== 'string') throw new Error('Service field group must be a string');
  if (service.icon != null) {
    if (typeof service.icon !== 'object' || Array.isArray(service.icon)) throw new Error('Service field icon must be an object');
    if (typeof service.icon.type !== 'string') throw new Error('Service field icon.type must be a string');
  }
  service.autoRestart = service.autoRestart == null ? false : coerceBool(service.autoRestart, 'autoRestart');
  for (const field of ['usePty', 'autoPort', 'sensitive']) {
    if (service[field] != null) service[field] = coerceBool(service[field], field);
  }
  for (const field of ['portEnvVar', 'profile', 'preRun']) {
    if (service[field] != null && typeof service[field] !== 'string') {
      throw new Error(`Service field ${field} must be a string`);
    }
  }
  return service;
}

function readServices(configPath) {
  if (!fs.existsSync(configPath)) return [];
  const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${configPath} must contain a JSON array`);
  return parsed;
}

async function main() {
  const configPath = defaultConfigPath();
  if (process.env.MUXLY_REGISTER_PRINT_PATH === 'true') {
    console.log(configPath);
    return;
  }

  let service;
  if (process.env.MUXLY_REGISTER_STDIN === 'true') {
    service = JSON.parse(await readStdin());
  } else if (process.env.MUXLY_REGISTER_SERVICE_JSON) {
    service = JSON.parse(process.env.MUXLY_REGISTER_SERVICE_JSON);
  } else {
    service = parseFlags(argv);
  }
  service = normalizeService(service);

  const services = readServices(configPath);
  const existingIndex = services.findIndex(item => item && item.id === service.id);
  const replace = process.env.MUXLY_REGISTER_REPLACE === 'true';

  if (existingIndex >= 0 && !replace) {
    throw new Error(`Service id already exists: ${service.id}. Use --replace only when replacing is intended.`);
  }
  if (existingIndex >= 0) services[existingIndex] = service;
  else services.push(service);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tempPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(services, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, configPath);

  const writtenServices = readServices(configPath);
  const writtenService = writtenServices.find(item => item && item.id === service.id);
  if (!writtenService) {
    throw new Error(`Service id was not found after write: ${service.id}`);
  }

  console.log(JSON.stringify({
    configPath,
    id: service.id,
    replaced: existingIndex >= 0,
    isArray: Array.isArray(writtenServices),
    count: writtenServices.length,
    ids: writtenServices.map(item => item.id),
    service: writtenService
  }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
NODE

node "$node_prog" "${passthrough[@]}"
