import http from 'http';
import { ApiAdapter } from '../../../src/adapters/api/ApiAdapter';

function request(port: number, method: string, path: string, body?: any): Promise<{ status: number, body: any }> {
    return new Promise((resolve, reject) => {
        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        const req = http.request({
            host: 'localhost',
            port,
            method,
            path,
            headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                let parsed: any = data;
                try { parsed = JSON.parse(data); } catch { /* keep raw */ }
                resolve({ status: res.statusCode ?? 0, body: parsed });
            });
        });
        req.on('error', reject);
        if(payload) req.write(payload);
        req.end();
    });
}

describe('ApiAdapter', () => {
    let presetPort: any;
    let adapter: ApiAdapter;
    const port = 4291;

    beforeEach((done) => {
        presetPort = {
            getAllPresets: jest.fn().mockReturnValue([
                { name: 'A', value: 'a' },
                { name: 'B', value: 'b' },
                { name: '', value: 'c' },
                { name: '', value: 'd' },
                { name: '', value: 'e' }
            ]),
            getNumPresets: jest.fn().mockReturnValue(5),
            setValueForPreset: jest.fn(),
            setNameForPreset: jest.fn()
        };
        adapter = new ApiAdapter(presetPort, port);
        adapter.start();
        setTimeout(done, 50);
    });

    afterEach((done) => {
        adapter.stop();
        setTimeout(done, 20);
    });

    test('GET /api/preset returns a plain object keyed by mode', async () => {
        const res = await request(port, 'GET', '/api/preset');

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ internet_radio: [
            { name: 'A', value: 'a' },
            { name: 'B', value: 'b' },
            { name: '', value: 'c' },
            { name: '', value: 'd' },
            { name: '', value: 'e' }
        ] });
    });

    test('POST /api/preset/:mode/:presetId sends a response and updates the preset value', async () => {
        const res = await request(port, 'POST', '/api/preset/internet_radio/2', { value: 'http://new.example.com' });

        expect(res.status).toBe(200);
        expect(presetPort.setValueForPreset).toHaveBeenCalledWith('internet_radio', 2, 'http://new.example.com');
        expect(presetPort.setNameForPreset).not.toHaveBeenCalled();
        expect(res.body).toEqual({ name: '', value: 'c' });
    });

    test('POST /api/preset/:mode/:presetId updates the preset name', async () => {
        const res = await request(port, 'POST', '/api/preset/internet_radio/0', { name: 'Kitchen FM' });

        expect(res.status).toBe(200);
        expect(presetPort.setNameForPreset).toHaveBeenCalledWith('internet_radio', 0, 'Kitchen FM');
        expect(presetPort.setValueForPreset).not.toHaveBeenCalled();
        expect(res.body).toEqual({ name: 'A', value: 'a' });
    });

    test('POST /api/mute returns 501 when setMute callback is not implemented', async () => {
        const res = await request(port, 'POST', '/api/mute', { muted: true });

        expect(res.status).toBe(501);
    });

    test('POST /api/mute invokes the setMute callback', async () => {
        const setMute = jest.fn().mockResolvedValue(undefined);
        const getState = jest.fn().mockReturnValue({ muted: true });
        adapter.onSetMute(setMute);
        adapter.onGetState(getState);

        const res = await request(port, 'POST', '/api/mute', { muted: true });

        expect(res.status).toBe(200);
        expect(setMute).toHaveBeenCalledWith(true);
        expect(res.body).toEqual({ muted: true });
    });

    test('POST /api/preset/:mode/:presetId rejects an out-of-range id', async () => {
        const res = await request(port, 'POST', '/api/preset/internet_radio/5', { value: 'x' });

        expect(res.status).toBe(400);
        expect(presetPort.setValueForPreset).not.toHaveBeenCalled();
    });
});
