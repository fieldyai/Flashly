const screens = {
    initial: document.getElementById('initial-screen'),
    connecting: document.getElementById('connecting-screen'),
    connected: document.getElementById('connected-screen')
};

const deviceName = document.getElementById('device-name');
const deviceNameInput = document.getElementById('device-name-input');
const connectButton = document.getElementById('button-connect');
const resetButton = document.getElementById('button-reset');
const imageStateButton = document.getElementById('button-image-state');
const testButton = document.getElementById('button-test');
const confirmButton = document.getElementById('button-confirm');
const imageList = document.getElementById('image-list');
const fileInfo = document.getElementById('file-info');
const fileStatus = document.getElementById('file-status');
const fileImage = document.getElementById('file-image');
const fileUpload = document.getElementById('file-upload');
const fileCancel = document.getElementById('file-cancel');
const bluetoothIsAvailable = document.getElementById('bluetooth-is-available');
const bluetoothIsAvailableMessage = document.getElementById('bluetooth-is-available-message');
const connectBlock = document.getElementById('connect-block');
const connectionError = document.getElementById('connection-error');
const connectionErrorMessage = document.getElementById('connection-error-message');
const closeConnectionError = document.getElementById('close-connection-error');
const uploadDropZone = document.getElementById('upload-drop-zone');
const uploadIcon = document.getElementById('upload-icon');
const uploadDropTitle = document.getElementById('upload-drop-title');
const uploadDropSubtitle = document.getElementById('upload-drop-subtitle');

const DEFAULT_DEVICE_PREFIX = 'Fieldy';
const rawSearch = window.location.search;
const urlParams = new URLSearchParams(rawSearch);
let firmwareUrlParam = urlParams.get('firmwareUrl') || urlParams.get('firmware');

if (!firmwareUrlParam) {
    try {
        const decodedSearch = decodeURIComponent(rawSearch.startsWith('?') ? rawSearch.slice(1) : rawSearch);
        const fallbackParams = new URLSearchParams(decodedSearch);
        firmwareUrlParam = fallbackParams.get('firmwareUrl') || fallbackParams.get('firmware');
    } catch (error) {
        console.warn('Failed to decode search params for firmware URL.', error);
    }
}
const firmwareUrl = firmwareUrlParam ? firmwareUrlParam.trim() : null;
const remoteFirmwareMode = Boolean(firmwareUrl);
let remoteFirmwareName = null;

if (remoteFirmwareMode) {
    try {
        const parsedUrl = new URL(firmwareUrl);
        const pathSegments = decodeURIComponent(parsedUrl.pathname).split('/');
        remoteFirmwareName = pathSegments.pop() || 'firmware.bin';
    } catch (error) {
        console.warn('Failed to parse firmware URL, using fallback name.', error);
        remoteFirmwareName = 'firmware.bin';
    }
}

if (remoteFirmwareMode) {
    uploadDropZone.classList.add('remote-mode');
    uploadDropZone.style.cursor = 'default';
    uploadDropSubtitle.innerText = 'Firmware will be downloaded automatically once a device connects.';
    uploadDropTitle.innerText = remoteFirmwareName ? `Remote firmware: ${remoteFirmwareName}` : 'Remote firmware';
    fileCancel.style.display = 'none';
    setUploadButtonLabel('Upload Firmware');
    fileUpload.disabled = true;
    fileStatus.innerText = 'Waiting for device connection to download firmware...';
}

const updateBluetoothAvailabilityUI = (available) => {
    if (available) {
        bluetoothIsAvailableMessage.innerText = 'Bluetooth is available in your browser.';
        bluetoothIsAvailable.className = 'alert alert-success';
        connectBlock.style.display = 'block';
    } else {
        bluetoothIsAvailable.className = 'alert alert-danger';
        bluetoothIsAvailableMessage.innerText = 'Bluetooth is not available in your browser.';
        connectBlock.style.display = 'none';
    }
};

if (navigator && navigator.bluetooth) {
    // If remote mode is active we still want to evaluate availability immediately
    updateBluetoothAvailabilityUI(true);

    if (typeof navigator.bluetooth.getAvailability === 'function') {
        navigator.bluetooth.getAvailability().then((available) => {
            updateBluetoothAvailabilityUI(available);
        }).catch(() => {
            updateBluetoothAvailabilityUI(false);
        });

        navigator.bluetooth.addEventListener?.('availabilitychanged', (event) => {
            updateBluetoothAvailabilityUI(event.value);
        });
    } else {
        updateBluetoothAvailabilityUI(true);
    }
} else {
    updateBluetoothAvailabilityUI(false);
}

let file = null;
let fileData = null;
let images = [];
let remoteFirmwareData = null;
let remoteFirmwareInfo = null;
let remoteFetchPromise = null;
let pendingFirmwareHash = null;
let autoTestHash = null;

const escapeHtml = (value) => {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        if (char === '&') return '&amp;';
        if (char === '<') return '&lt;';
        if (char === '>') return '&gt;';
        if (char === '"') return '&quot;';
        return '&#39;';
    });
};

const storedDeviceName = localStorage.getItem('deviceName');
if (deviceNameInput) {
    if (storedDeviceName) {
        deviceNameInput.value = storedDeviceName;
    }
    deviceNameInput.addEventListener('change', () => {
        localStorage.setItem('deviceName', deviceNameInput.value);
    });
}

const buildImageInfoHTML = (info) => {
    let infoHTML = '<div class="upload-info-grid">';

    infoHTML += `<div class="detail-row">`;
    infoHTML += `<span class="detail-label">Version</span>`;
    infoHTML += `<span class="detail-value">v${info.version}</span>`;
    infoHTML += `</div>`;

    infoHTML += `<div class="detail-row">`;
    infoHTML += `<span class="detail-label">Hash</span>`;
    infoHTML += `<div class="hash-container">`;
    infoHTML += `<span class="detail-value hash-value" title="${info.hash}">${info.hash.substring(0, 8)}...</span>`;
    infoHTML += `<i class="bi-clipboard upload-hash-copy-icon" data-hash="${info.hash}" title="Copy full hash"></i>`;
    infoHTML += `</div>`;
    infoHTML += `</div>`;

    infoHTML += '</div>';

    return infoHTML;
};

const attachUploadHashCopyHandler = () => {
    document.querySelector('.upload-hash-copy-icon')?.addEventListener('click', async function() {
        const hash = this.getAttribute('data-hash');
        try {
            await navigator.clipboard.writeText(hash);
            this.classList.remove('bi-clipboard');
            this.classList.add('bi-clipboard-check', 'copied');
            setTimeout(() => {
                this.classList.remove('bi-clipboard-check', 'copied');
                this.classList.add('bi-clipboard');
            }, 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    });
};

function setUploadButtonLabel(label) {
    if (!fileUpload) return;
    fileUpload.innerHTML = `
        <span class="badge rounded-pill bg-light text-primary me-2">1</span>
        <i class="bi-upload me-2"></i>${label}
    `;
}

setUploadButtonLabel('Upload Firmware');

const prepareRemoteFirmware = async () => {
    if (!remoteFirmwareMode) {
        return;
    }

    const safeName = escapeHtml(remoteFirmwareName || 'Firmware');

    if (remoteFirmwareData) {
        file = { name: remoteFirmwareName };
        fileData = remoteFirmwareData;
        fileStatus.innerHTML = `<div class="file-ready-status"><i class="bi-check-circle-fill me-2"></i>${safeName} - Ready to upload</div>`;
        fileInfo.innerHTML = buildImageInfoHTML(remoteFirmwareInfo);
        attachUploadHashCopyHandler();
        fileUpload.disabled = false;
        setUploadButtonLabel('Upload Firmware');
        return;
    }

    if (!remoteFetchPromise) {
        fileStatus.innerHTML = `<div class="file-selected-status"><i class="bi-cloud-arrow-down me-2"></i>Downloading remote firmware...</div>`;
        fileInfo.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Fetching firmware...';
        fileUpload.disabled = true;

        remoteFetchPromise = (async () => {
            try {
                const response = await fetch(firmwareUrl, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`Download failed with status ${response.status}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                remoteFirmwareData = arrayBuffer;
                remoteFirmwareInfo = await mcumgr.imageInfo(arrayBuffer);
                file = { name: remoteFirmwareName };
                fileData = arrayBuffer;
                fileStatus.innerHTML = `<div class="file-ready-status"><i class="bi-check-circle-fill me-2"></i>${safeName} - Ready to upload</div>`;
                fileInfo.innerHTML = buildImageInfoHTML(remoteFirmwareInfo);
                attachUploadHashCopyHandler();
                fileUpload.disabled = false;
                setUploadButtonLabel('Upload Firmware');
                pendingFirmwareHash = remoteFirmwareInfo.hash;
            } catch (error) {
                remoteFirmwareData = null;
                remoteFirmwareInfo = null;
                fileData = null;
                fileStatus.innerHTML = `<div class="file-error-status"><i class="bi-x-circle-fill me-2"></i>${safeName} download failed</div>`;
                fileInfo.innerHTML = `<span class="text-danger">ERROR: ${error.message}</span>`;
                fileUpload.disabled = false;
                setUploadButtonLabel('Retry Firmware Download');
            } finally {
                remoteFetchPromise = null;
            }
        })();
    }

    try {
        await remoteFetchPromise;
    } catch (error) {
        // Error already surfaced in UI.
    }
};

// Close connection error alert
closeConnectionError.addEventListener('click', () => {
    connectionError.style.display = 'none';
});

const mcumgr = new MCUManager();

if (remoteFirmwareMode) {
    prepareRemoteFirmware();
}

mcumgr.onConnecting(() => {
    console.log('Connecting...');
    connectionError.style.display = 'none'; // Hide any previous errors
    screens.initial.style.display = 'none';
    screens.connected.style.display = 'none';
    screens.connecting.style.display = 'block';
});
mcumgr.onConnect(() => {
    deviceName.innerText = mcumgr.name;
    connectionError.style.display = 'none'; // Hide any previous errors
    screens.connecting.style.display = 'none';
    screens.initial.style.display = 'none';
    screens.connected.style.display = 'block';
    imageList.innerHTML = '';

    if (remoteFirmwareMode) {
        uploadIcon.style.display = 'none';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
        fileImage.value = '';
        file = null;
        fileData = null;
        fileUpload.disabled = true;
        fileCancel.style.display = 'none';
        prepareRemoteFirmware();
    } else {
        uploadIcon.style.display = '';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
        fileStatus.innerText = 'No file selected';
        fileInfo.innerHTML = '';
        fileImage.value = '';
        file = null;
        fileData = null;
        fileUpload.disabled = true;
        fileCancel.style.display = 'none';
    }

    testButton.disabled = true;
    resetButton.disabled = true;
    confirmButton.disabled = true;

    mcumgr.cmdImageState();
});
mcumgr.onDisconnect((error) => {
    deviceName.innerText = 'Connect your device';
    screens.connecting.style.display = 'none';
    screens.connected.style.display = 'none';
    screens.initial.style.display = 'block';

    // Show error message if disconnect was due to an error
    if (error) {
        connectionErrorMessage.innerText = error.message || 'An unknown error occurred while connecting to the device.';
        connectionError.style.display = 'block';
    }
});

mcumgr.onMessage(({ op, group, id, data, length }) => {
    switch (group) {
        case MGMT_GROUP_ID_OS:
            switch (id) {
                case OS_MGMT_ID_ECHO:
                    alert(data.r);
                    break;
                case OS_MGMT_ID_TASKSTAT:
                    console.table(data.tasks);
                    break;
                case OS_MGMT_ID_MPSTAT:
                    console.log(data);
                    break;
            }
            break;
        case MGMT_GROUP_ID_IMAGE:
            switch (id) {
                case IMG_MGMT_ID_STATE:
                    console.log('[DEBUG] Image state response:', { op, group, id, data, length });

                    if (!data) {
                        console.error('[ERROR] No data received in image state response');
                        return;
                    }

                    if (!data.images) {
                        console.error('[ERROR] No images array in response data:', data);
                        return;
                    }

                    console.log('[DEBUG] Images array:', data.images);
                    images = data.images;
                    let imagesHTML = '';

                    const getBooleanIcon = (value) => {
                        if (value === true) {
                            return '<i class="bi-check-circle-fill text-success"></i>';
                        } else if (value === false) {
                            return '<i class="bi-x-circle-fill text-danger"></i>';
                        }
                        return '<i class="bi-dash-circle text-secondary"></i>';
                    };

                    let autoCommandIssued = false;
                    let canTest = false;
                    let canReset = false;
                    let slotZeroConfirmed = true;
                    images?.forEach((image, index) => {
                        console.log(`[DEBUG] Processing image ${index}:`, image);

                        if (!image.hash) {
                            console.error(`[ERROR] Image ${index} has no hash:`, image);
                            return;
                        }

                        const hashStr = Array.from(image.hash).map(byte => byte.toString(16).padStart(2, '0')).join('');
                        const statusBadge = image.active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Standby</span>';

                        imagesHTML += `<div class="image-slot ${image.active ? 'active' : 'standby'}">`;
                        imagesHTML += `<div class="image-slot-header">`;
                        imagesHTML += `<h3>Slot #${image.slot}</h3>`;
                        imagesHTML += statusBadge;
                        imagesHTML += `</div>`;

                        imagesHTML += `<div class="image-slot-details">`;
                        imagesHTML += `<div class="detail-row">`;
                        imagesHTML += `<span class="detail-label">Version</span>`;
                        imagesHTML += `<span class="detail-value">v${image.version}</span>`;
                        imagesHTML += `</div>`;

                        imagesHTML += `<div class="detail-row">`;
                        imagesHTML += `<span class="detail-label">Bootable</span>`;
                        imagesHTML += `<span class="detail-value">${getBooleanIcon(image.bootable)}</span>`;
                        imagesHTML += `</div>`;

                        imagesHTML += `<div class="detail-row">`;
                        imagesHTML += `<span class="detail-label">Confirmed</span>`;
                        imagesHTML += `<span class="detail-value">${getBooleanIcon(image.confirmed)}</span>`;
                        imagesHTML += `</div>`;

                    imagesHTML += `<div class="detail-row">`;
                    imagesHTML += `<span class="detail-label">Pending</span>`;
                    imagesHTML += `<span class="detail-value">${getBooleanIcon(image.pending)}</span>`;
                    imagesHTML += `</div>`;

                        imagesHTML += `<div class="detail-row">`;
                        imagesHTML += `<span class="detail-label">Hash</span>`;
                        imagesHTML += `<div class="hash-container">`;
                        imagesHTML += `<span class="detail-value hash-value" title="${hashStr}">${hashStr.substring(0, 8)}...</span>`;
                        imagesHTML += `<i class="bi-clipboard hash-copy-icon" data-hash="${hashStr}" title="Copy full hash"></i>`;
                        imagesHTML += `</div>`;
                        imagesHTML += `</div>`;

                        imagesHTML += `</div>`;
                        imagesHTML += '</div>';

                        if (!autoCommandIssued && autoTestHash && hashStr === autoTestHash) {
                            autoCommandIssued = true;
                            autoTestHash = null;
                            try {
                                const hashBytes = new Uint8Array(image.hash);
                                testButton.disabled = true;
                                resetButton.disabled = true;
                                console.log('[AUTO] Initiating image test for uploaded firmware');
                                mcumgr.cmdImageTest(hashBytes).then(async () => {
                                    try {
                                        console.log('[AUTO] Firmware test command sent, refreshing state');
                                        await mcumgr.cmdImageState();
                                    } catch (stateError) {
                                        console.error('[AUTO] Failed to refresh state after test:', stateError);
                                    }
                                }).catch(error => {
                                    console.error('[AUTO] Failed to send test command:', error);
                                });
                            } catch (err) {
                                console.error('[AUTO] Unable to initiate test automatically:', err);
                            }
                        }

                        if (image.slot === 1) {
                            if (image.pending === false) {
                                canTest = true;
                            }
                            if (image.pending === true) {
                                canReset = true;
                            }
                        }

                        if (image.slot === 0) {
                            slotZeroConfirmed = image.confirmed === true;
                        }
                    });
                    imageList.innerHTML = imagesHTML;

                    // Add click handlers for hash copy icons
                    document.querySelectorAll('.hash-copy-icon').forEach(icon => {
                        icon.addEventListener('click', async () => {
                            const hash = icon.getAttribute('data-hash');
                            try {
                                await navigator.clipboard.writeText(hash);
                                icon.classList.remove('bi-clipboard');
                                icon.classList.add('bi-clipboard-check', 'copied');
                                setTimeout(() => {
                                    icon.classList.remove('bi-clipboard-check', 'copied');
                                    icon.classList.add('bi-clipboard');
                                }, 2000);
                            } catch (err) {
                                console.error('Failed to copy:', err);
                            }
                        });
                    });

                    console.log('[DEBUG] Setting button states...');
                    testButton.disabled = !slotZeroConfirmed || !canTest;
                    resetButton.disabled = !canReset;
                    confirmButton.disabled = !(data.images && data.images.length > 0 && data.images[0] && data.images[0].confirmed === false);
                    console.log('[DEBUG] Button states set - test:', testButton.disabled, 'reset:', resetButton.disabled, 'confirm:', confirmButton.disabled);

                    break;
            }
            break;
        default:
            console.log('Unknown group');
            break;
    }
});

mcumgr.onImageUploadProgress(({ percentage, timeoutAdjusted, newTimeout }) => {
    // Hide drop zone text during upload
    uploadIcon.style.display = 'none';
    uploadDropTitle.style.display = 'none';
    uploadDropSubtitle.style.display = 'none';

    if (timeoutAdjusted) {
        fileStatus.innerHTML = `
            <div class="upload-progress-container">
                <div class="upload-progress-text">
                    <i class="bi-upload me-2"></i>Uploading... ${percentage}%
                </div>
                <div class="progress upload-progress-bar">
                    <div class="progress-bar" role="progressbar" style="width: ${percentage}%" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
                <div class="upload-warning-text">
                    <i class="bi-exclamation-circle me-1"></i>Device is responding slowly, adjusting timeout to ${newTimeout}ms...
                </div>
            </div>
        `;
    } else {
        fileStatus.innerHTML = `
            <div class="upload-progress-container">
                <div class="upload-progress-text">
                    <i class="bi-upload me-2"></i>Uploading... ${percentage}%
                </div>
                <div class="progress upload-progress-bar">
                    <div class="progress-bar" role="progressbar" style="width: ${percentage}%" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100"></div>
                </div>
            </div>
        `;
    }
});

mcumgr.onImageUploadFinished(() => {
    if (remoteFirmwareMode) {
        uploadIcon.style.display = 'none';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
        fileStatus.innerHTML = '<span class="text-success">✓ Upload complete!</span>';
        if (remoteFirmwareInfo && remoteFirmwareData) {
            fileInfo.innerHTML = buildImageInfoHTML(remoteFirmwareInfo);
            attachUploadHashCopyHandler();
        }
        fileUpload.disabled = false;
        fileCancel.style.display = 'none';
    } else {
        uploadIcon.style.display = '';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
        fileStatus.innerText = 'No file selected';
        fileInfo.innerHTML = '<span class="text-success">✓ Upload complete!</span>';
        fileImage.value = '';
        file = null;
        fileData = null;
        fileUpload.disabled = true;
        fileCancel.style.display = 'none';
        setTimeout(() => {
            fileInfo.innerHTML = '';
        }, 3000);
    }
    if (pendingFirmwareHash) {
        autoTestHash = pendingFirmwareHash;
        pendingFirmwareHash = null;
    }
    mcumgr.cmdImageState();
});

mcumgr.onImageUploadCancelled(() => {
    // Upload was cancelled, form is already reset by cancel button
    // Just log for debugging
    console.log('Upload cancelled');
});

mcumgr.onImageUploadError(({ error, errorCode, consecutiveTimeouts, totalTimeouts }) => {
    if (remoteFirmwareMode) {
        uploadIcon.style.display = 'none';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
    } else {
        uploadIcon.style.display = '';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
    }

    let tips = `
        <div class="upload-error-tips">
            <strong>What you can try:</strong>
            <ul>
                <li>Check that the device is still connected and in range</li>
                <li>Try disconnecting and reconnecting to the device</li>
                <li>Power cycle the device and try again</li>
                <li>The device firmware may be slow - try a smaller image file</li>
            </ul>
        </div>
    `;

    // For error code 2 (busy/bad state), provide specific guidance
    if (errorCode === 2) {
        tips = `
            <div class="upload-error-tips">
                <strong>What you can try:</strong>
                <ul>
                    <li>If Slot #1 already shows as pending, click button 2 (Reset Device) to reboot before retrying the upload</li>
                    <li>If the running image is still in test mode, click button 3 (Make Slot #0 Permanent) to finalize it</li>
                    <li>Review the Images section to ensure only one firmware image is pending at a time</li>
                </ul>
            </div>
        `;
    }

    fileStatus.innerHTML = `<div class="upload-error-alert">
        <div class="mb-2"><strong>Upload Failed</strong></div>
        <div class="mb-3">${error}</div>
        ${tips}
    </div>`;
    fileUpload.disabled = false;
});

if (!remoteFirmwareMode) {
    fileImage.addEventListener('change', () => {
        file = fileImage.files[0];
        if (!file) return;

        uploadIcon.style.display = 'none';
        uploadDropTitle.style.display = 'none';
        uploadDropSubtitle.style.display = 'none';

        fileCancel.style.display = '';

        fileData = null;
        fileStatus.innerHTML = `<div class="file-selected-status"><i class="bi-file-earmark-binary me-2"></i>${file.name}</div>`;
        fileInfo.innerHTML = '<div class="spinner-border spinner-border-sm" role="status"><span class="visually-hidden">Loading...</span></div> Analyzing...';

        const reader = new FileReader();
        reader.onload = async () => {
            fileData = reader.result;
            try {
                const info = await mcumgr.imageInfo(fileData);
                fileStatus.innerHTML = `<div class="file-ready-status"><i class="bi-check-circle-fill me-2"></i>${file.name} - Ready to upload</div>`;
                fileInfo.innerHTML = buildImageInfoHTML(info);
                attachUploadHashCopyHandler();
                fileUpload.disabled = false;
                pendingFirmwareHash = info.hash;
            } catch (e) {
                fileStatus.innerHTML = `<div class="file-error-status"><i class="bi-x-circle-fill me-2"></i>${file.name} - Invalid file</div>`;
                fileInfo.innerHTML = `<span class="text-danger">ERROR: ${e.message}</span>`;
                fileUpload.disabled = true;
            }
        };
        reader.readAsArrayBuffer(file);
    });

    fileCancel.addEventListener('click', event => {
        event.stopPropagation();
        mcumgr.cancelUpload();
        uploadIcon.style.display = '';
        uploadDropTitle.style.display = '';
        uploadDropSubtitle.style.display = '';
        fileStatus.innerText = 'No file selected';
        fileInfo.innerHTML = '';
        fileImage.value = '';
        file = null;
        fileData = null;
        fileUpload.disabled = true;
        fileCancel.style.display = 'none';
    });

    uploadDropZone.addEventListener('click', () => {
        fileImage.click();
    });

    uploadDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadDropZone.classList.add('drag-over');
    });

    uploadDropZone.addEventListener('dragleave', () => {
        uploadDropZone.classList.remove('drag-over');
    });

    uploadDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadDropZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            fileImage.files = files;
            const event = new Event('change', { bubbles: true });
            fileImage.dispatchEvent(event);
        }
    });
}

fileUpload.addEventListener('click', async event => {
    event.stopPropagation();
    if (remoteFirmwareMode && !fileData) {
        await prepareRemoteFirmware();
    }
    if (!fileData) {
        return;
    }
    fileUpload.disabled = true;
    mcumgr.cmdUpload(fileData);
});

connectButton.addEventListener('click', async () => {
    let prefix = DEFAULT_DEVICE_PREFIX;
    if (deviceNameInput && deviceNameInput.value.trim()) {
        prefix = deviceNameInput.value.trim();
    }
    await mcumgr.connect([{ namePrefix: prefix }]);
});

resetButton.addEventListener('click', async () => {
    await mcumgr.cmdReset();
});

imageStateButton.addEventListener('click', async () => {
    await mcumgr.cmdImageState();
});

testButton.addEventListener('click', async () => {
    if (!images || images.length === 0) return;
    const slotOne = images.find(image => image.slot === 1 && image.hash);
    if (!slotOne) return;
    const hashBytes = new Uint8Array(slotOne.hash);
    autoTestHash = null;
    pendingFirmwareHash = null;
    testButton.disabled = true;
    resetButton.disabled = true;
    try {
        await mcumgr.cmdImageTest(hashBytes);
        await mcumgr.cmdImageState();
    } catch (error) {
        console.error('Manual test failed:', error);
    }
});

confirmButton.addEventListener('click', async () => {
    if (images.length > 0 && images[0].confirmed === false) {
        await mcumgr.cmdImageConfirm(images[0].hash);
    }
});
