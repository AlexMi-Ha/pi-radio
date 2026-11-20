export interface InputPort {
    onVolumeChange(callback: (delta: number) => void): void;
    onModeToggle(callback: () => void): void;
    onPowerToggle(callback: () => void): void;
    onActionPress(callback: () => void): void;
}
