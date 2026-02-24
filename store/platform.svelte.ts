import { browser } from '$app/environment';

export const platform = $state({
    get name() { 
        return browser ? (window.__PLATFORM__ || '?') : 'unknown'; 
    },
    get isLinux() { return this.name === 'linux'; },
    get isWindows() { return this.name === 'windows'; },
    get isMac() { return this.name === 'mac'; }
});