# Listet alle sichtbaren Top-Level-Fenster von Code.exe / Cursor.exe als JSON
# und kann eines davon in den Vordergrund holen.
#
#   powershell -File windows.ps1 list
#   powershell -File windows.ps1 focus <hwnd>
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

  const int SW_RESTORE = 9;

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
}
'@

if ($Action -eq 'list') {
  $editorPids = @{}
  Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -in 'Code', 'Code - Insiders', 'Cursor', 'VSCodium', 'windsurf' } |
    ForEach-Object { $editorPids[[uint32]$_.Id] = $_.ProcessName }

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
  $ok = [AmpelWin]::Focus([IntPtr][long]$Hwnd)
  ConvertTo-Json -InputObject @{ ok = [bool]$ok } -Compress
  exit 0
}

Write-Output '{"ok":false,"error":"unbekannte aktion"}'
exit 1
