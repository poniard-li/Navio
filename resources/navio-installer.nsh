!include LogicLib.nsh
!define NAVIO_INSTALLER_SOURCE_DIR "${__FILEDIR__}"

!macro NavioValidateTarget
  ${If} ${FileExists} "$INSTDIR\PORTABLE"
  ${OrIf} ${FileExists} "$INSTDIR\DEX-STUDIO-NEXT"
    MessageBox MB_OK|MB_ICONSTOP "此目录包含 Navio 便携版或用户数据，请选择独立的安装目录。数据不会被修改。$\r$\n$\r$\nThis directory contains portable Navio or user data. Choose a separate installation directory. No data has been changed." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro NavioRequireCurrentUser
  ${If} ${isForAllUsers}
    MessageBox MB_OK|MB_ICONSTOP "此安装程序仅支持当前 Windows 用户。请取消 /allusers 参数后重试。$\r$\n$\r$\nThis installer supports the current Windows user only. Remove /allusers and retry." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  StrCpy $hasPerMachineInstallation "0"
  StrCpy $hasPerUserInstallation "1"
!macroend

!macro customInit
  !insertmacro NavioRequireCurrentUser
  !insertmacro setInstallModePerUser
!macroend

!macro customUnInit
  !insertmacro NavioRequireCurrentUser
  ${If} $installMode != "CurrentUser"
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

# Used by both installation and uninstallation before replacing/removing files.
# Never close or kill a proxy client: its normal exit must restore system proxy.
!macro customCheckAppRunning
  !insertmacro NavioValidateTarget
  navio_check_running:
    ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 603
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请先在系统托盘中右键 Navio 并选择“退出”，然后点击“重试”。安装器不会强制关闭 Navio。$\r$\n$\r$\nQuit Navio from its system tray menu, then select Retry. The installer will not force it to close." /SD IDCANCEL IDRETRY navio_check_running
      SetErrorLevel 2
      Quit
    ${EndIf}
!macroend

!macro customUnInstall
  !insertmacro NavioValidateTarget
  ${IfNot} ${isUpdated}
    InitPluginsDir
    File /oname=$PLUGINSDIR\navio-startup-cleanup.ps1 "${NAVIO_INSTALLER_SOURCE_DIR}\..\scripts\release-windows-uninstall.ps1"
    # Pass paths as environment data, never interpolate them into PowerShell code.
    System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_UNINSTALL_SCRIPT", t "$PLUGINSDIR\navio-startup-cleanup.ps1")'
    System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_UNINSTALL_EXE", t "$INSTDIR\${APP_EXECUTABLE_FILENAME}")'
    nsExec::ExecToStack /TIMEOUT=15000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ([scriptblock]::Create([IO.File]::ReadAllText([Environment]::GetEnvironmentVariable('NAVIO_UNINSTALL_SCRIPT')))) -Executable ([Environment]::GetEnvironmentVariable('NAVIO_UNINSTALL_EXE'))"`
    Pop $R0
    Pop $R1
    System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_UNINSTALL_SCRIPT", p 0)'
    System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_UNINSTALL_EXE", p 0)'
    ${If} $R0 != 0
      DetailPrint "An owned startup entry could not be removed. Disable the Navio startup entry in Windows if it remains."
    ${EndIf}
  ${EndIf}
!macroend
