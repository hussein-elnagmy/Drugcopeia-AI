//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

func showError(text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString("Dawaya")
	body, _ := syscall.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x10)
}

func openExternal(url string) error {
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}
