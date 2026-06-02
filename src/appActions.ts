import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./appUtils";

type AppendLog = (id: string, chunk: string) => void;

export async function openInEditor(
  cwd: string,
  serviceId: string,
  editorCommand: string,
  appendLog: AppendLog
) {
  try {
    await invoke("open_in_editor", { cwd, editorCommand });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open in editor failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}

export async function openInFileManager(cwd: string, serviceId: string, appendLog: AppendLog) {
  try {
    await invoke("open_in_file_manager", { cwd });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open folder failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}

export async function openServiceUrl(port: number, serviceId: string, appendLog: AppendLog) {
  try {
    await invoke("open_url", { url: `http://localhost:${port}` });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open url failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}
