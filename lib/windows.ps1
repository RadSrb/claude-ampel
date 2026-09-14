# Listet alle sichtbaren Top-Level-Fenster von Code.exe / Cursor.exe als JSON
# und kann eines davon in den Vordergrund holen.
#
#   powershell -File windows.ps1 list
#   powershell -File windows.ps1 focus <hwnd>   (holt das Fenster vor und setzt den Schreibfokus)
#   powershell -File windows.ps1 typeforeground  (wartet auf einen Editor im Vordergrund und setzt dort den Schreibfokus)
#
# Get-Process liefert pro Prozess nur EIN MainWindowHandle -- VS Code betreibt
# aber mehrere Fenster je Prozess. Deshalb EnumWindows ueber die Win32-API.

param(
  [Parameter(Position = 0)][string]$Action = 'list',
  [Parameter(Position = 1)][string]$Hwnd = ''
)

$ErrorActionPreference = 'Stop'

# Ohne das liefert PowerShell die Ausgabe in der Konsolen-Codepage:
# Umlaute und … kommen dann zerstoert in Node an.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class AmpelWin {
  [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint uCode, uint uMapType);

  const int SW_RESTORE = 9;

  // F13 gibt es auf keiner normalen Tastatur -- deshalb kann dieser Druck
  // niemals von Hand ausgeloest werden und kollidiert mit nichts.
  const byte VK_F13 = 0x7C;
  const uint KEYEVENTF_KEYUP = 0x0002;

  public class Win { public long Hwnd; public uint Pid; public string Title; }

  public static List<Win> List() {
    var found = new List<Win>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      found.Add(new Win { Hwnd = h.ToInt64(), Pid = pid, Title = sb.ToString() });
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // SetForegroundWindow allein wird von Windows oft ignoriert, wenn der Aufrufer
  // nicht im Vordergrund ist. Der Thread-Attach-Trick umgeht das zuverlaessig.
  public static bool Focus(IntPtr hWnd) {
    if (IsIconic(hWnd)) ShowWindow(hWnd, SW_RESTORE);
    uint fgPid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint ownThread = GetCurrentThreadId();
    if (fgThread != ownThread) AttachThreadInput(ownThread, fgThread, true);
    bool ok = SetForegroundWindow(hWnd);
    if (fgThread != ownThread) AttachThreadInput(ownThread, fgThread, false);
    return ok;
  }

  // Holt das Fenster nach vorn UND setzt den Schreibfokus ins Claude-Chatfeld.
  //
  // SetForegroundWindow aktiviert nur das Fenster -- der Tastaturfokus bleibt,
  // wo er zuletzt war (Editor, Explorer, Terminal). Deshalb zusaetzlich F13,
  // das in keybindings.json auf "claude-vscode.focus" liegt.
  //
  // Der Druck geht erst raus, wenn das Fenster wirklich vorn ist. Sonst
  // bekaeme ihn das Programm, das gerade noch den Vordergrund hatte.
  public static bool FocusAndType(IntPtr hWnd) {
    bool ok = Focus(hWnd);
    for (int i = 0; i < 25 && GetForegroundWindow() != hWnd; i++) System.Threading.Thread.Sleep(20);
    if (GetForegroundWindow() != hWnd) return ok;
    SendFocusKey();
    return ok;
  }

  public static void SendFocusKey() {
    // VS Code braucht nach dem Aktivieren einen Moment, bis es Tasten annimmt.
    System.Threading.Thread.Sleep(60);
    byte scan = (byte)MapVirtualKey(VK_F13, 0);
    keybd_event(VK_F13, scan, 0, UIntPtr.Zero);
    keybd_event(VK_F13, scan, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static long ForegroundPid() {
    uint pid;
    GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    return pid;
  }
}
'@

function Get-EditorPids {
  $map = @{}
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -in 'Code', 'Code - Insiders', 'Cursor', 'VSCodium', 'windsurf' } |
    ForEach-Object { $map[[uint32]$_.Id] = $_.ProcessName }
  return $map
}

if ($Action -eq 'list') {
  $editorPids = Get-EditorPids

  $result = [AmpelWin]::List() |
    Where-Object { $editorPids.ContainsKey($_.Pid) } |
    ForEach-Object {
      [pscustomobject]@{
        hwnd  = $_.Hwnd
        pid   = [int]$_.Pid
        app   = $editorPids[$_.Pid]
        title = $_.Title
      }
    }

  # ConvertTo-Json macht aus einem Einzelobjekt kein Array -- erzwingen.
  ConvertTo-Json -InputObject @($result) -Compress
  exit 0
}

if ($Action -eq 'focus') {
  if (-not $Hwnd) { Write-Output '{"ok":false,"error":"kein hwnd"}'; exit 1 }
  $ok = [AmpelWin]::FocusAndType([IntPtr][long]$Hwnd)
  ConvertTo-Json -InputObject @{ ok = [bool]$ok } -Compress
  exit 0
}

# Fuer den Rueckfallweg: `code --reuse-window` kehrt sofort zurueck, das Fenster
# kommt erst danach nach vorn. Deshalb wird hier gewartet, bis wirklich ein
# Editor den Vordergrund hat -- und nur dann F13 geschickt. Ohne diese Pruefung
# bekaeme den Druck irgendein anderes Programm.
if ($Action -eq 'typeforeground') {
  $editorPids = Get-EditorPids
  $vorn = $false
  for ($i = 0; $i -lt 20; $i++) {
    if ($editorPids.ContainsKey([uint32][AmpelWin]::ForegroundPid())) { $vorn = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $vorn) {
    ConvertTo-Json -InputObject @{ ok = $false; error = 'kein editor im vordergrund' } -Compress
    exit 0
  }
  [AmpelWin]::SendFocusKey()
  ConvertTo-Json -InputObject @{ ok = $true } -Compress
  exit 0
}

Write-Output '{"ok":false,"error":"unbekannte aktion"}'
exit 1
