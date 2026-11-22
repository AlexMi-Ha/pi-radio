const api = new Api();

const NUM_PRESETS = 5;

const el = {
    powerBtn: document.getElementById('power_btn'),
    idleView: document.getElementById('idle_view'),
    idlePowerBtn: document.getElementById('idle_power_btn'),
    powerView: document.getElementById('power_view'),

    nowPlayingPrimary: document.getElementById('now_playing_primary'),
    nowPlayingSecondary: document.getElementById('now_playing_secondary'),

    modeBtnIradio: document.getElementById('mode_btn_iradio'),
    modeBtnBt: document.getElementById('mode_btn_bt'),
    modeIradio: document.getElementById('mode_iradio'),
    modeBt: document.getElementById('mode_bt'),

    presetGrid: document.getElementById('preset_grid'),
    editPresetsToggle: document.getElementById('edit_presets_toggle'),
    presetEditor: document.getElementById('preset_editor'),

    btStatusDot: document.getElementById('bt_status_dot'),
    btStatusText: document.getElementById('bt_status_text'),

    volumeSlider: document.getElementById('volume_slider'),
    volumeValue: document.getElementById('volume_value'),
    muteBtn: document.getElementById('mute_btn'),

    toast: document.getElementById('toast'),
};

let currentState = null;
let presetValues = emptyPresets();
let draggingVolume = false;
let editorOpen = false;

init();

async function init() {
    buildPresetGrid();
    buildPresetEditor();
    wireEvents();

    await Promise.all([refreshState(), refreshPresets()]);
    setInterval(refreshState, 5000);
}

function wireEvents() {
    el.powerBtn.addEventListener('click', togglePower);
    el.idlePowerBtn.addEventListener('click', togglePower);

    el.modeBtnIradio.addEventListener('click', () => changeMode('internet_radio'));
    el.modeBtnBt.addEventListener('click', () => changeMode('bluetooth'));

    el.editPresetsToggle.addEventListener('click', () => {
        editorOpen = !editorOpen;
        el.presetEditor.classList.toggle('hidden', !editorOpen);
        el.editPresetsToggle.textContent = editorOpen ? 'Done editing' : 'Edit stations';
    });

    el.volumeSlider.addEventListener('input', () => {
        draggingVolume = true;
        el.volumeValue.textContent = el.volumeSlider.value + '%';
    });
    el.volumeSlider.addEventListener('change', async () => {
        try {
            const state = await api.setVolume(el.volumeSlider.value);
            draggingVolume = false;
            render(state);
        } catch (err) {
            draggingVolume = false;
            showError(err);
        }
    });

    el.muteBtn.addEventListener('click', toggleMute);
}

async function toggleMute() {
    try {
        const state = await api.setMute(!currentState?.muted);
        render(state);
    } catch (err) {
        showError(err);
    }
}

async function togglePower() {
    const next = currentState?.power === 'power' ? 'idle' : 'power';
    try {
        api.setPower(next).catch(showError);
        setTimeout(async () => await refreshState(), 100)
    } catch (err) {
        showError(err);
    }
}

async function changeMode(mode) {
    try {
        const state = await api.setMode(mode);
        render(state);
    } catch (err) {
        showError(err);
    }
}

async function selectPreset(idx) {
    if (!presetValues[idx]?.value) {
        showError(new Error(`Station ${idx + 1} has no URL set yet - edit it below first`));
        if (!editorOpen) {
            el.editPresetsToggle.click();
        }
        return;
    }
    try {
        const state = await api.setCurrentPreset(idx);
        render(state);
    } catch (err) {
        showError(err);
    }
}

async function savePreset(idx, value, name, button) {
    try {
        const preset = await api.setPresetForMode('internet_radio', idx, value, name);
        presetValues[idx] = preset;
        renderPresetGrid();
        renderNowPlaying(currentState);
        flashSaved(button);
    } catch (err) {
        showError(err);
    }
}

function emptyPresets() {
    return Array.from({ length: NUM_PRESETS }, () => ({ name: '', value: '' }));
}

function flashSaved(button) {
    const original = button.textContent;
    button.textContent = 'Saved';
    button.classList.add('saved');
    setTimeout(() => {
        button.textContent = original;
        button.classList.remove('saved');
    }, 1200);
}

async function refreshState() {
    try {
        const state = await api.getState();
        render(state);
    } catch (err) {
        showError(err);
    }
}

async function refreshPresets() {
    try {
        const presets = await api.getAllPresets();
        presetValues = presets.internet_radio ?? emptyPresets();
        renderPresetGrid();
        renderPresetEditorValues();
    } catch (err) {
        showError(err);
    }
}

function render(state) {
    currentState = state;

    const isOn = state.power === 'power';
    el.powerBtn.classList.toggle('is-on', isOn);
    el.idleView.classList.toggle('hidden', isOn);
    el.powerView.classList.toggle('hidden', !isOn);
    if (!isOn) {
        return;
    }

    renderMode(state.mode);
    renderPresetGrid();
    renderBluetooth(state);
    renderNowPlaying(state);

    if (!draggingVolume) {
        el.volumeSlider.value = state.volume;
        el.volumeValue.textContent = Math.round(state.volume) + '%';
    }

    el.muteBtn.classList.toggle('is-muted', !!state.muted);
    el.volumeValue.textContent = state.muted ? 'Muted' : Math.round(state.volume) + '%';
}

function renderMode(mode) {
    el.modeBtnIradio.classList.toggle('active', mode === 'internet_radio');
    el.modeBtnBt.classList.toggle('active', mode === 'bluetooth');
    el.modeIradio.classList.toggle('hidden', mode !== 'internet_radio');
    el.modeBt.classList.toggle('hidden', mode !== 'bluetooth');
}

function renderNowPlaying(state) {
    if (state.mode === 'internet_radio') {
        const label = stationLabel(state.preset, presetValues[state.preset]);
        el.nowPlayingPrimary.textContent = label;
        el.nowPlayingSecondary.textContent = state.nowPlaying?.title ?? '';
    } else {
        el.nowPlayingPrimary.textContent = 'Bluetooth';
        el.nowPlayingSecondary.textContent = state.nowPlaying?.title ?? '';
    }
}

function renderBluetooth(state) {
    el.btStatusDot.classList.remove('paired', 'pairing');
    if (state.pairing) {
        el.btStatusDot.classList.add('pairing');
        el.btStatusText.textContent = 'Pairing...';
    } else if (state.connected) {
        el.btStatusDot.classList.add('paired');
        el.btStatusText.textContent = 'Paired';
    } else {
        el.btStatusText.textContent = 'Not Paired';
    }
}

function buildPresetGrid() {
    el.presetGrid.innerHTML = '';
    for (let i = 0; i < NUM_PRESETS; i++) {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.dataset.index = String(i);
        btn.innerHTML = `<span class="preset-btn__index">${i + 1}</span><span class="preset-btn__label"></span>`;
        btn.addEventListener('click', () => selectPreset(i));
        el.presetGrid.appendChild(btn);
    }
}

function renderPresetGrid() {
    const buttons = el.presetGrid.querySelectorAll('.preset-btn');
    buttons.forEach((btn, i) => {
        const preset = presetValues[i];
        btn.classList.toggle('empty', !preset?.value);
        btn.classList.toggle('active', currentState?.mode === 'internet_radio' && currentState?.preset === i);
        btn.querySelector('.preset-btn__label').textContent = preset?.value ? (preset.name || hostnameOf(preset.value)) : 'Empty';
    });
}

function buildPresetEditor() {
    el.presetEditor.innerHTML = '';
    for (let i = 0; i < NUM_PRESETS; i++) {
        const row = document.createElement('div');
        row.className = 'preset-editor__row';

        const index = document.createElement('span');
        index.className = 'preset-editor__index';
        index.textContent = String(i + 1);

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Station name';
        nameInput.className = 'preset-editor__name';
        nameInput.dataset.index = String(i);
        nameInput.dataset.field = 'name';

        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.placeholder = 'Stream URL';
        urlInput.dataset.index = String(i);
        urlInput.dataset.field = 'value';

        const save = document.createElement('button');
        save.className = 'btn';
        save.textContent = 'Save';
        save.addEventListener('click', () => savePreset(i, urlInput.value.trim(), nameInput.value.trim(), save));
        const saveOnEnter = (e) => {
            if (e.key === 'Enter') save.click();
        };
        nameInput.addEventListener('keydown', saveOnEnter);
        urlInput.addEventListener('keydown', saveOnEnter);

        row.append(index, nameInput, urlInput, save);
        el.presetEditor.appendChild(row);
    }
}

function renderPresetEditorValues() {
    const rows = el.presetEditor.querySelectorAll('.preset-editor__row');
    rows.forEach((row, i) => {
        row.querySelector('[data-field="name"]').value = presetValues[i]?.name ?? '';
        row.querySelector('[data-field="value"]').value = presetValues[i]?.value ?? '';
    });
}

function stationLabel(preset, presetValue) {
    if (!presetValue?.value) {
        return `Station ${preset + 1} (empty)`;
    }
    return presetValue.name || hostnameOf(presetValue.value);
}

function hostnameOf(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
}

let toastTimer;
function showError(err) {
    console.error(err);
    el.toast.textContent = err?.message ?? String(err);
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 4000);
}
