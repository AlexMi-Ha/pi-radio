export function clamp(min:number,max:number, val:number) {
    return Math.min(Math.max(val, min), max);
}

export function wrap(min: number, max:number, current: number, delta: number) {
    const range = max - min + 1;
    return ((current - min + delta) % range + range) % range + min;
}