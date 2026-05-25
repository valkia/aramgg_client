!include LogicLib.nsh

!macro ensureAppInstallSubdir
  ${If} "$INSTDIR" != ""
    StrLen $0 "$INSTDIR"
    StrLen $1 "${APP_FILENAME}"

    ${If} $0 >= $1
      IntOp $2 0 - $1
      StrCpy $3 "$INSTDIR" $1 $2
    ${Else}
      StrCpy $3 ""
    ${EndIf}

    ${If} $3 != "${APP_FILENAME}"
      StrCpy $4 "$INSTDIR" 1 -1
      ${If} $4 == "\"
        StrCpy $INSTDIR "$INSTDIR${APP_FILENAME}"
      ${Else}
        StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro ensureAppInstallSubdir
!macroend

!ifndef BUILD_UNINSTALLER
  Function NormalizeInstallDirectoryPage
    !insertmacro ensureAppInstallSubdir
    Abort
  FunctionEnd

  !macro customPageAfterChangeDir
    Page custom NormalizeInstallDirectoryPage
  !macroend
!endif
