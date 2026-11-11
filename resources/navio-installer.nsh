!include LogicLib.nsh
!define NAVIO_INSTALLER_SOURCE_DIR "${__FILEDIR__}"

!ifndef BUILD_UNINSTALLER
  !ifndef NAVIO_PAYLOAD_MANIFEST
    !error "Build Navio installers with scripts/release-windows.cjs so the payload is verified."
  !endif
!endif

!macro NavioInstallFailure MESSAGE
  MessageBox MB_OK|MB_ICONSTOP "安装未完成。${MESSAGE}$\r$\n$\r$\nInstallation stopped. Free disk space or check the reported error, then retry. Existing user data is retained." /SD IDOK
  SetErrorLevel 3
  Quit
!macroend

!macro NavioRunSafety MODE
  ReadRegStr $R2 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_MODE", t "${MODE}")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_HELPER", t "$PLUGINSDIR\navio-install.ps1")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_MANIFEST", t "$PLUGINSDIR\navio-payload.json")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_STAGE", t "$PLUGINSDIR\navio-payload")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_TEMP", t "$PLUGINSDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_TARGET", t "$INSTDIR")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_EXE", t "$EXEPATH")'
  System::Call 'kernel32::SetEnvironmentVariable(t "NAVIO_INSTALL_OLD", t "$R2")'
  nsExec::ExecToStack /TIMEOUT=600000 `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ([scriptblock]::Create([IO.File]::ReadAllText([Environment]::GetEnvironmentVariable('NAVIO_INSTALL_HELPER'))))"`
  Pop $R0
  Pop $R1
  ${If} $R0 != 0
    DetailPrint "$R1"
    !insertmacro NavioInstallFailure "$R1"
  ${EndIf}
!macroend

!macro NavioPreparePayload
  !ifndef APP_64
    !error "Navio installer safety currently supports the offline x64 payload only."
  !endif
  !ifdef ZIP_COMPRESSION
    !error "Navio installer safety requires a 7z payload."
  !endif
  InitPluginsDir
  ClearErrors
  File /oname=$PLUGINSDIR\navio-install.ps1 "${NAVIO_SAFETY_HELPER}"
  File /oname=$PLUGINSDIR\navio-payload.json "${NAVIO_PAYLOAD_MANIFEST}"
  ${If} ${Errors}
    !insertmacro NavioInstallFailure "Unable to prepare verification files in the temporary directory."
  ${EndIf}
  !insertmacro NavioRunSafety "Preflight"
  ClearErrors
  !ifdef COMPRESS
    SetCompress off
  !endif
  File /oname=$PLUGINSDIR\navio-payload.7z "${APP_64}"
  !ifdef COMPRESS
    SetCompress "${COMPRESS}"
  !endif
  ${If} ${Errors}
    !insertmacro NavioInstallFailure "Unable to write the temporary application archive."
  ${EndIf}
  Push $OUTDIR
  CreateDirectory "$PLUGINSDIR\navio-payload"
  SetOutPath "$PLUGINSDIR\navio-payload"
  Nsis7z::Extract "$PLUGINSDIR\navio-payload.7z"
  Pop $R0
  SetOutPath $R0
  # Nsis7z may return without reporting a short write. Verify every file before uninstalling anything.
  !insertmacro NavioRunSafety "VerifyStage"
!macroend

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
  !ifndef BUILD_UNINSTALLER
    !include "${NAVIO_EXTRACTION_OVERRIDE}"
    !insertmacro NavioPreparePayload
  !endif
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
