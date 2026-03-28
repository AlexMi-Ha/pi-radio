class Api {

    async getState() {
        return await this.get('/state');
    }
    async setPower(isPowered) {
        return await this.post('/power', {"power": isPowered});
    }
    async setMode(mode) {
        return await this.post('/mode', { 'mode': mode });
    }
    async setVolume(vol) {
        return await this.post('/volume', {'volume': vol});
    }
    async setCurrentPreset(idx) {
        return await this.post('/preset', {'preset': idx});
    }
    async getAllPresets() {
        return await this.get('/preset');
    }
    async getAllPresetsForMode(mode) {
        return await this.get('/preset/'+mode);
    }
    async getPresetForMode(mode, idx) {
        return await this.get('/preset/'+mode+'/'+idx);
    }
    async setPresetForMode(mode, idx, value) {
        return await this.post('/preset/'+mode+'/'+idx, {'value': value});
    }


    async get(path) {
        const res = await fetch('/api' + path)
        return await res.json();
    }
    async post(path, body) {
        const res = await fetch('/api' + path, {
            method: "POST",
            body: JSON.stringify(body),
            headers: new Headers({'content-type': 'application/json'})
        })
        return await res.json();
    }
}