/* Clinical Co-Pilot widget — auto-fires patient brief on page load */

var _copilotPid    = 0;
var _copilotApiUrl = '';
var _copilotCollapsed = false;
var _copilotStreaming  = false;

function copilotInit(pid, apiUrl) {
    _copilotPid    = pid;
    _copilotApiUrl = apiUrl;
    copilotFetch(false);
}

function copilotRefresh() {
    if (_copilotStreaming) return;
    copilotFetch(true);
}

function copilotToggle() {
    _copilotCollapsed = !_copilotCollapsed;
    var body   = document.getElementById('copilot-panel-body');
    var btn    = document.getElementById('copilot-toggle-btn');
    if (_copilotCollapsed) {
        body.classList.add('collapsed');
        btn.textContent = '▼';
        btn.title = 'Expand';
    } else {
        body.classList.remove('collapsed');
        btn.textContent = '▲';
        btn.title = 'Collapse';
    }
}

function copilotFetch(forceRefresh) {
    _copilotStreaming = true;
    var content = document.getElementById('copilot-content');
    var badge   = document.getElementById('copilot-status-badge');
    var footer  = document.getElementById('copilot-footer');

    content.textContent = '';
    content.innerHTML   = '<span class="streaming-cursor"></span>';
    badge.className     = 'copilot-badge copilot-badge-loading';
    badge.textContent   = 'Loading…';
    footer.style.display = 'none';

    var csrfToken = '';
    try {
        // In OpenEMR tab frame, csrf_token_js is set on top frame
        csrfToken = top.csrf_token_js || '';
    } catch (e) {
        csrfToken = '';
    }

    var body = new URLSearchParams();
    body.append('pid',             _copilotPid);
    body.append('csrf_token_form', csrfToken);
    if (forceRefresh) {
        body.append('refresh', '1');
    }

    var accumulated = '';
    var isCached    = false;

    fetch(_copilotApiUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    body.toString(),
    })
    .then(function(response) {
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var lineBuffer = '';

        function pump() {
            return reader.read().then(function(result) {
                if (result.done) {
                    _copilotStreaming = false;
                    return;
                }
                lineBuffer += decoder.decode(result.value, { stream: true });
                var lines = lineBuffer.split('\n');
                lineBuffer = lines.pop(); // keep incomplete line

                var eventType = '';
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i].trim();
                    if (line.startsWith('event: ')) {
                        eventType = line.slice(7);
                    } else if (line.startsWith('data: ')) {
                        var dataStr = line.slice(6);
                        var data;
                        try { data = JSON.parse(dataStr); } catch (e) { continue; }

                        if (eventType === 'delta') {
                            accumulated += data.text || '';
                            content.textContent = accumulated;
                            // re-append cursor
                            var cursor = document.createElement('span');
                            cursor.className = 'streaming-cursor';
                            content.appendChild(cursor);
                        } else if (eventType === 'cached') {
                            isCached    = true;
                            accumulated = data.text || '';
                            content.textContent = accumulated;
                        } else if (eventType === 'done') {
                            // Remove cursor
                            content.textContent = accumulated;
                            badge.className   = 'copilot-badge ' + (isCached ? 'copilot-badge-cached' : 'copilot-badge-live');
                            badge.textContent = isCached ? 'Cached' : 'Live';
                            footer.style.display = '';
                            _copilotStreaming = false;
                        } else if (eventType === 'error') {
                            content.textContent = '⚠ ' + (data.message || 'Error generating brief.');
                            badge.className   = 'copilot-badge copilot-badge-error';
                            badge.textContent = 'Error';
                            _copilotStreaming = false;
                        }
                        eventType = '';
                    }
                }
                return pump();
            });
        }
        return pump();
    })
    .catch(function(err) {
        content.textContent = '⚠ Could not load brief: ' + err.message;
        badge.className   = 'copilot-badge copilot-badge-error';
        badge.textContent = 'Error';
        _copilotStreaming = false;
    });
}
