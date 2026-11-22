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
    async setPresetForMode(mode, idx, value, name) {
        return await this.post('/preset/'+mode+'/'+idx, {'value': value, 'name': name});
    }

    async get(path) {
        const res = await fetch('/api' + path);
        return await this.parse(res);
    }
    async post(path, body) {
        const res = await fetch('/api' + path, {
            method: "POST",
            body: JSON.stringify(body),
            headers: new Headers({'content-type': 'application/json'})
        });
        return await this.parse(res);
    }

    async parse(res) {
        const text = await res.text();
        let data = undefined;
        if(text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }
        if(!res.ok) {
            const message = typeof data === 'string' && data ? data : `Request failed (${res.status})`;
            throw new Error(message);
        }
        return data;
    }
}
