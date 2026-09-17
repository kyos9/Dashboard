' 창 없이 실행한다.
'
' 검은 콘솔 창을 없애는 방법은 결국 이것뿐이다 — 윈도우에는 "창 없이 띄우기"를
' bat 파일 스스로 할 방법이 없어서, 창을 만들지 않는 실행기(wscript)에게 부탁한다.
'
' 인자로 받은 것을 그대로 명령으로 넘긴다. 0 = 창 숨김, False = 끝날 때까지 안 기다림.
Set shell = CreateObject("WScript.Shell")
command = ""
For i = 0 To WScript.Arguments.Count - 1
  command = command & """" & WScript.Arguments(i) & """ "
Next
shell.Run command, 0, False
