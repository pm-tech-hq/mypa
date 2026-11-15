/**
 * "Prove you're the person signed in to this computer": Windows Hello (the
 * Windows PIN, fingerprint or face) or Touch ID on a Mac. Used to reset a
 * forgotten journal passcode without losing entries, which are protected by
 * the OS account anyway (the journal key is wrapped by DPAPI / Keychain).
 */
import { execFile } from "node:child_process";

import { systemPreferences } from "electron";

export type VerifyMethod = "windows-hello" | "touch-id";

/** Windows PowerShell 5.1 can reach the WinRT UserConsentVerifier. */
function helloScript(request: boolean, reason: string): string {
  const quoted = reason.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$V = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$a = Await ($V::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ("$a" -ne 'Available') { "availability:$a"; exit 0 }
${request ? `$r = Await ($V::RequestVerificationAsync('${quoted}')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
"result:$r"` : `"availability:Available"`}
`;
}

function runPowerShell(script: string, timeoutMs: number): Promise<string> {
  // -EncodedCommand takes UTF-16LE base64: no temp file, no quoting trouble
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: timeoutMs },
      (err, stdout) => resolve(err ? "" : String(stdout).trim()),
    );
  });
}

let cached: { at: number; method: VerifyMethod | null } | null = null;

/** Which check this computer offers, or null when there's none set up. */
export async function verifyMethod(): Promise<VerifyMethod | null> {
  if (cached && Date.now() - cached.at < 60_000) return cached.method;
  let method: VerifyMethod | null = null;
  if (process.platform === "darwin") {
    method = systemPreferences.canPromptTouchID() ? "touch-id" : null;
  } else if (process.platform === "win32") {
    const out = await runPowerShell(helloScript(false, ""), 20_000);
    method = out.endsWith("availability:Available") ? "windows-hello" : null;
  }
  cached = { at: Date.now(), method };
  return method;
}

let inFlight: Promise<boolean> | null = null;

/** Shows the OS prompt; true only when the OS confirms the user. One at a time. */
export function verifyUser(reason: string): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (process.platform === "darwin") {
        if (!systemPreferences.canPromptTouchID()) return false;
        return await systemPreferences.promptTouchID(reason).then(
          () => true,
          () => false,
        );
      }
      if (process.platform === "win32") {
        // the prompt waits for the person, so allow a few minutes
        const out = await runPowerShell(helloScript(true, reason), 5 * 60_000);
        return out.endsWith("result:Verified");
      }
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
