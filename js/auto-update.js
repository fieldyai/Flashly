const searchParams = new URLSearchParams(window.location.search);
const firmwareUrlParam = searchParams.get('firmwareUrl');

if (!firmwareUrlParam) {
    // No firmware URL - redirect to main page
    window.location.href = 'index.html';
}

const escapeHtml = (unsafe) => {
    if (typeof unsafe !== 'string') return '';
    return unsafe.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case '\'': return '&#39;';
            default: return char;
        }
    });
};

// DOM elements
const autoSteps = document.getElementById('auto-steps');
const autoStatus = document.getElementById('auto-status');
const autoError = document.getElementById('auto-error');
const autoErrorMessage = document.getElementById('auto-error-message');
const autoActionWrap = document.getElementById('auto-action-wrap');
const autoStartBtn = document.getElementById('auto-start-btn');
const autoSuccess = document.getElementById('auto-success');
const autoProgressWrap = document.getElementById('auto-progress-wrap');
const autoProgressBarInner = document.getElementById('auto-progress-bar-inner');
const autoProgressText = document.getElementById('auto-progress-text');
const autoTitle = document.getElementById('auto-title');
const autoSubtitle = document.getElementById('auto-subtitle');
const autoHeaderIcon = document.getElementById('auto-header-icon');

// State
const mcumgr = new MCUManager({
    reconnectTimeout: 60000,  // retry reconnect for 60s after disconnect
    reconnectInterval: 2000,  // try every 2s
});
let firmwareData = null;
let images = [];
let state = 'init'; // init, downloading, ready, connecting, uploading, upload_done, testing, resetting, confirming, done, error

// --- UI helpers ---

const setStep = (stepName, stepState) => {
    const step = autoSteps.querySelector(`[data-step="${stepName}"]`);
    if (step) {
        step.classList.remove('active', 'done', 'error');
        if (stepState) step.classList.add(stepState);
    }
};

const setLine = (afterStep, done) => {
    const allChildren = Array.from(autoSteps.children);
    const stepEl = autoSteps.querySelector(`[data-step="${afterStep}"]`);
    const idx = allChildren.indexOf(stepEl);
    if (idx >= 0 && idx + 1 < allChildren.length) {
        const line = allChildren[idx + 1];
        if (line.classList.contains('auto-step-line')) {
            line.classList.toggle('done', done);
        }
    }
};

const showError = (msg) => {
    state = 'error';
    autoStatus.style.display = 'none';
    autoProgressWrap.style.display = 'none';
    autoError.style.display = 'block';
    autoErrorMessage.textContent = msg;
    autoActionWrap.style.display = 'grid';
    autoStartBtn.innerHTML = '<i class="bi-arrow-clockwise me-2"></i>Retry';
};

const showStatus = (msg) => {
    autoStatus.style.display = 'block';
    autoStatus.innerHTML = `<div class="spinner-border spinner-border-sm me-2" role="status"></div> ${escapeHtml(msg)}`;
};

const showProgress = (pct, text) => {
    autoProgressWrap.style.display = 'block';
    autoProgressBarInner.style.width = `${pct}%`;
    autoProgressText.textContent = text || `${pct}%`;
};

const hideProgress = () => {
    autoProgressWrap.style.display = 'none';
};

const resetSteps = () => {
    ['download', 'connect', 'upload', 'install', 'confirm'].forEach(s => setStep(s, null));
    ['download', 'connect', 'upload', 'install'].forEach(s => setLine(s, false));
};

// --- Flow steps ---

const downloadFirmware = async () => {
    state = 'downloading';
    autoError.style.display = 'none';
    autoSuccess.style.display = 'none';
    autoActionWrap.style.display = 'none';
    resetSteps();

    setStep('download', 'active');
    showStatus('Downloading firmware...');

    let firmwareUrl = firmwareUrlParam.trim();

    if (!firmwareUrl.toLowerCase().startsWith('https://')) {
        try {
            const decoded = decodeURIComponent(firmwareUrl);
            if (decoded.toLowerCase().startsWith('https://')) firmwareUrl = decoded;
        } catch (e) { /* ignore */ }
    }

    if (!firmwareUrl.toLowerCase().startsWith('https://')) {
        setStep('download', 'error');
        showError('Only HTTPS firmware URLs are supported.');
        return;
    }

    try {
        const response = await fetch(firmwareUrl);
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);

        const arrayBuffer = await response.arrayBuffer();
        firmwareData = arrayBuffer;

        // Validate the firmware image
        await mcumgr.imageInfo(arrayBuffer);

        setStep('download', 'done');
        setLine('download', true);

        state = 'ready';
        autoStatus.style.display = 'block';
        autoStatus.innerHTML = '<i class="bi-check-circle-fill text-success me-2"></i> Firmware ready. Press Start to begin.';
        autoActionWrap.style.display = 'grid';
        autoStartBtn.innerHTML = '<i class="bi-play-fill me-2"></i>Start Update';
    } catch (err) {
        setStep('download', 'error');
        showError(`Failed to download firmware: ${err.message}`);
    }
};

const connectDevice = async () => {
    state = 'connecting';
    autoActionWrap.style.display = 'none';
    autoError.style.display = 'none';
    setStep('connect', 'active');
    showStatus('Select your Fieldy device...');

    try {
        await mcumgr.connect([{ namePrefix: 'Fieldy' }]);
        // onConnect callback drives next step
    } catch (err) {
        setStep('connect', 'error');
        showError(`Connection failed: ${err.message || 'Cancelled or device not found'}`);
    }
};

const startUpload = () => {
    state = 'uploading';
    setStep('connect', 'done');
    setLine('connect', true);
    setStep('upload', 'active');
    showStatus('Uploading firmware...');
    showProgress(0, '0%');
    mcumgr.cmdUpload(firmwareData);
};

const testImage = () => {
    state = 'testing';
    setStep('upload', 'done');
    setLine('upload', true);
    setStep('install', 'active');
    hideProgress();
    showStatus('Setting firmware for install...');

    if (images.length > 1 && images[1].hash) {
        mcumgr.cmdImageTest(images[1].hash);
    } else {
        mcumgr.cmdImageState();
    }
};

const resetDevice = () => {
    state = 'resetting';
    showStatus('Restarting device...');
    mcumgr.cmdReset();
};

const confirmImage = () => {
    state = 'confirming';
    setStep('install', 'done');
    setLine('install', true);
    setStep('confirm', 'active');
    showStatus('Confirming update...');

    if (images.length > 0 && images[0].hash) {
        mcumgr.cmdImageConfirm(images[0].hash);
    } else {
        mcumgr.cmdImageState();
    }
};

const finish = () => {
    state = 'done';
    setStep('confirm', 'done');
    autoStatus.style.display = 'none';
    hideProgress();
    autoSuccess.style.display = 'block';
    autoHeaderIcon.classList.remove('bi-arrow-up-circle', 'text-primary');
    autoHeaderIcon.classList.add('bi-check-circle-fill', 'text-success');
    autoTitle.textContent = 'Update Complete!';
    autoSubtitle.textContent = 'Your Fieldy is up to date.';
};

// --- MCUManager callbacks ---

mcumgr.onConnecting(() => {
    console.log('[AUTO] Connecting...');
    if (state === 'resetting') {
        showStatus('Device restarting... reconnecting...');
    }
});

mcumgr.onConnect(() => {
    if (state === 'done') return;
    console.log('[AUTO] Connected! state:', state);

    if (state === 'resetting' || state === 'needs_reconnect') {
        // Reconnected after reset - proceed to confirm
        autoActionWrap.style.display = 'none';
        showStatus('Reconnected! Verifying...');
        setTimeout(() => {
            state = 'confirming';
            setStep('install', 'done');
            setLine('install', true);
            setStep('confirm', 'active');
            mcumgr.cmdImageState();
        }, 1000);
    } else {
        // Initial connection - get image state, then upload
        mcumgr.cmdImageState();
    }
});

mcumgr.onDisconnect((error) => {
    if (state === 'done') return;
    console.log('[AUTO] Disconnected, state:', state, error);

    if (state === 'resetting' || state === 'waiting_reconnect') {
        // All retry attempts exhausted after reset. Show manual reconnect button.
        showStatus('Could not reconnect automatically. Reconnect to finish the update.');
        autoActionWrap.style.display = 'grid';
        autoStartBtn.innerHTML = '<i class="bi-bluetooth me-2"></i>Reconnect';
        state = 'needs_reconnect';
        return;
    }

    if (state !== 'error' && state !== 'ready' && state !== 'init' && state !== 'downloading' && state !== 'needs_reconnect') {
        setStep('connect', 'error');
        showError(`Device disconnected unexpectedly: ${error?.message || 'Unknown reason'}`);
    }
});

mcumgr.onImageUploadProgress(({ percentage }) => {
    if (state !== 'uploading') return;
    showProgress(percentage, `Uploading... ${percentage}%`);
});

mcumgr.onImageUploadFinished(() => {
    if (state !== 'uploading') return;
    console.log('[AUTO] Upload finished!');
    hideProgress();
    state = 'upload_done';
    mcumgr.cmdImageState();
});

mcumgr.onImageUploadError(({ error }) => {
    setStep('upload', 'error');
    showError(`Upload failed: ${error}`);
});

mcumgr.onMessage(({ op, group, id, data }) => {
    if (state === 'done' || state === 'error') return;

    if (group === MGMT_GROUP_ID_IMAGE && id === IMG_MGMT_ID_STATE) {
        if (!data || !data.images) return;
        images = data.images;

        console.log('[AUTO] Image state received, state:', state, 'images:', images);

        if (state === 'connecting') {
            startUpload();
        } else if (state === 'upload_done') {
            testImage();
        } else if (state === 'testing') {
            if (images.length > 1 && images[1].pending === true) {
                // Test was set, proceed to reset
                resetDevice();
            } else if (images.length > 1 && images[1].hash && images[1].pending === false) {
                // State fetched but not tested yet
                mcumgr.cmdImageTest(images[1].hash);
            }
        } else if (state === 'confirming') {
            if (images.length > 0 && images[0].confirmed === false) {
                mcumgr.cmdImageConfirm(images[0].hash);
            } else if (images.length > 0 && images[0].confirmed === true) {
                finish();
            }
        }
    }
});

// --- Start button ---

autoStartBtn.addEventListener('click', async () => {
    if (state === 'ready') {
        await connectDevice();
    } else if (state === 'needs_reconnect') {
        // Reconnect after reset to confirm the update
        autoActionWrap.style.display = 'none';
        showStatus('Select your Fieldy device...');
        try {
            await mcumgr.connect([{ namePrefix: 'Fieldy' }]);
            // onConnect callback will handle the confirm flow
        } catch (err) {
            showStatus('Device has restarted. Reconnect to finish the update.');
            autoActionWrap.style.display = 'grid';
            autoStartBtn.innerHTML = '<i class="bi-bluetooth me-2"></i>Reconnect';
        }
    } else if (state === 'error') {
        autoHeaderIcon.classList.remove('bi-check-circle-fill', 'text-success');
        autoHeaderIcon.classList.add('bi-arrow-up-circle', 'text-primary');
        autoTitle.textContent = 'Firmware Update';
        autoSubtitle.textContent = 'Update your Fieldy device';
        try { mcumgr.disconnect(); } catch (e) { /* ignore */ }
        await downloadFirmware();
    }
});

// --- Go ---
downloadFirmware();
