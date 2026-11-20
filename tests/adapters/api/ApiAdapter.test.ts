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
            getAllPresets: jest.fn().mockReturnValue(['a', 'b', 'c', 'd', 'e']),
            getNumPresets: jest.fn().mockReturnValue(5),
            setValueForPreset: jest.fn()
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
        expect(res.body).toEqual({ internet_radio: ['a', 'b', 'c', 'd', 'e'] });
    });

    test('POST /api/preset/:mode/:presetId sends a response and updates the preset', async () => {
        const res = await request(port, 'POST', '/api/preset/internet_radio/2', { value: 'http://new.example.com' });

        expect(res.status).toBe(200);
        expect(presetPort.setValueForPreset).toHaveBeenCalledWith('internet_radio', 2, 'http://new.example.com');
        expect(res.body).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    test('POST /api/preset/:mode/:presetId rejects an out-of-range id', async () => {
        const res = await request(port, 'POST', '/api/preset/internet_radio/5', { value: 'x' });

        expect(res.status).toBe(400);
        expect(presetPort.setValueForPreset).not.toHaveBeenCalled();
    });
});
