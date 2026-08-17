; Windows owns the default-app choice. The installer only advertises readit in
; Open with and never writes the hash-protected default-app key.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\readit.md" "" "Markdown Document"
  WriteRegStr HKCU "Software\Classes\readit.md\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "Software\Classes\readit.md\shell" "" "open"
  WriteRegStr HKCU "Software\Classes\readit.md\shell\open" "" "Open with ${PRODUCTNAME}"
  WriteRegStr HKCU "Software\Classes\readit.md\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr HKCU "Software\Classes\.md\OpenWithProgids" "readit.md" ""
  WriteRegStr HKCU "Software\Classes\.markdown\OpenWithProgids" "readit.md" ""
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKCU "Software\Classes\.md\OpenWithProgids" "readit.md"
  DeleteRegValue HKCU "Software\Classes\.markdown\OpenWithProgids" "readit.md"
  DeleteRegKey /ifempty HKCU "Software\Classes\.md\OpenWithProgids"
  DeleteRegKey /ifempty HKCU "Software\Classes\.markdown\OpenWithProgids"
  DeleteRegKey HKCU "Software\Classes\readit.md"
  !insertmacro UPDATEFILEASSOC
!macroend
