//go:build !windows

package main

import "syscall"

func memoryBytes() (total int64, free int64) {
	return 0, 0
}

func freeDiskBytes(dir string) int64 {
	return 0
}

func hiddenSysProcAttr() *syscall.SysProcAttr {
	return nil
}
