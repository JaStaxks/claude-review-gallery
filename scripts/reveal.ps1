# Opens the folder holding $Path with that file selected (Explorer's "Show in folder"),
# then brings that window to the front.
# Explorer is started through WMI so it is not a child of this short-lived
# process: a host that ends its children with the process leaves it running.
param([string]$Path)
$folder = Split-Path -Parent $Path
$cmd = 'explorer.exe /select,"' + $Path + '"'
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
if ($r.ReturnValue -ne 0) { exit [int]$r.ReturnValue }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RgFront {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  public static string Front(IntPtr h) {
    // Windows lets a background process raise a window only while it shares
    // input with the foreground window's thread, so join it for the call.
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint me = GetCurrentThreadId();
    bool att = fg != me && AttachThreadInput(me, fg, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    ShowWindow(h, IsIconic(h) ? 9 : 5);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    if (att) AttachThreadInput(me, fg, false);
    return "attached=" + att + " set=" + ok + " now=" + (GetForegroundWindow() == h);
  }
}
"@

$shell = New-Object -ComObject Shell.Application
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 100
  foreach ($w in @($shell.Windows())) {
    try {
      if ($w.Document.Folder.Self.Path -eq $folder) { [void][RgFront]::Front([IntPtr]$w.HWND); exit 0 }
    } catch {}
  }
}

exit 0
