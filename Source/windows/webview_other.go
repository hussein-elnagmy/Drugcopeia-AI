//go:build !windows

package main

import "errors"

func runNativeWindow(appURL, dataDir string) error {
	return errors.New("native window is only available on Windows")
}
