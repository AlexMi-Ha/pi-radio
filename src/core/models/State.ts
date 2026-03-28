export type Mode = "internet_radio" | "bluetooth" | "fm" | "spotify";
export type Power = "power" | "idle";

export class State {
    power: Power;
    mode: Mode;
    volume: number;
    preset: number; 

    constructor() {
        this.power = "idle";
        this.mode = "internet_radio";
        this.volume = 50;
        this.preset = 0
    }
}