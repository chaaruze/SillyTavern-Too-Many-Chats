/**
 * Too Many Chats - SillyTavern Extension
 * Organizes chats per character into collapsible folders
 * Uses 'Shadow View' architecture for stability
 * @author chaaruze
 * @version 1.3.0
 */

(function () {
    'use strict';

    const MODULE_NAME = 'chat_folders';
    const EXTENSION_NAME = 'Too Many Chats';

    const defaultSettings = Object.freeze({
        folders: {},
        characterFolders: {},
        version: '1.3.0'
    });

    let isRebuilding = false;
    let rebuildTimer = null;

    // ========== SETTINGS ==========

    function getSettings() {
        const context = SillyTavern.getContext();
        const { extensionSettings } = context;

        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }

        // Ensure defaults
        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
            }
        }

        return extensionSettings[MODULE_NAME];
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ========== IDS & HELPERS ==========

    function generateId() {
        return 'folder_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function getCurrentCharacterId() {
        const context = SillyTavern.getContext();
        if (context.characterId !== undefined && context.characters[context.characterId]) {
            return context.characters[context.characterId].avatar || context.characters[context.characterId].name;
        }
        return null;
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== LOGIC ==========

    function createFolder(name) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) {
            toastr.warning('Select a character first');
            return null;
        }

        const folderId = generateId();
        const folderCount = Object.keys(settings.folders).filter(id =>
            settings.characterFolders[characterId]?.includes(id)
        ).length;

        settings.folders[folderId] = {
            name: name || 'New Folder',
            chats: [],
            collapsed: false,
            order: folderCount
        };

        if (!settings.characterFolders[characterId]) {
            settings.characterFolders[characterId] = [];
        }
        settings.characterFolders[characterId].push(folderId);

        saveSettings();
        triggerRebuild();
        return folderId;
    }

    function renameFolder(folderId, newName) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].name = newName;
            saveSettings();
            triggerRebuild();
        }
    }

    function deleteFolder(folderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId || !settings.folders[folderId]) return;

        const charFolders = settings.characterFolders[characterId];
        if (charFolders) {
            const index = charFolders.indexOf(folderId);
            if (index > -1) {
                charFolders.splice(index, 1);
            }
        }
        delete settings.folders[folderId];
        saveSettings();
        triggerRebuild();
    }

    function toggleFolderCollapse(folderId) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].collapsed = !settings.folders[folderId].collapsed;
            saveSettings();
            // Fast UI update
            const content = document.querySelector(`.tmc_content[data-parent="${folderId}"]`);
            const toggle = document.querySelector(`.tmc_toggle[data-parent="${folderId}"]`);
            if (content && toggle) {
                content.style.display = settings.folders[folderId].collapsed ? 'none' : 'block';
                toggle.textContent = settings.folders[folderId].collapsed ? '▶' : '▼';
            }
        }
    }

    function moveChatToFolder(fileName, targetFolderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        // Remove from source
        const charFolderIds = settings.characterFolders[characterId] || [];
        for (const fid of charFolderIds) {
            if (settings.folders[fid]?.chats) {
                const idx = settings.folders[fid].chats.indexOf(fileName);
                if (idx > -1) settings.folders[fid].chats.splice(idx, 1);
            }
        }

        // Add to target
        if (targetFolderId && targetFolderId !== 'uncategorized' && settings.folders[targetFolderId]) {
            if (!settings.folders[targetFolderId].chats) settings.folders[targetFolderId].chats = [];
            settings.folders[targetFolderId].chats.push(fileName);
        }

        saveSettings();
        triggerRebuild();
    }

    function getFoldersForCurrentCharacter() {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return [];

        const folderIds = settings.characterFolders[characterId] || [];
        return folderIds
            .map(id => ({ id, ...settings.folders[id] }))
            .filter(f => f.name)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    function getChatFolder(fileName) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return null;

        const folderIds = settings.characterFolders[characterId] || [];
        for (const fid of folderIds) {
            if (settings.folders[fid]?.chats?.includes(fileName)) return fid;
        }
        return null;
    }

    // ========== SHADOW VIEW ENGINE ==========

    function triggerRebuild() {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(buildShadowView, 50);
    }

    function buildShadowView() {
        if (isRebuilding) return;
        isRebuilding = true;

        try {
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (!popup || popup.style.display === 'none') return;

            // 1. Find the container and original items
            const originalBlocks = Array.from(popup.querySelectorAll('.select_chat_block'));
            if (originalBlocks.length === 0) return;

            const container = originalBlocks[0].parentElement;
            if (!container) return;

            // 2. Identify the character
            const characterId = getCurrentCharacterId();
            if (!characterId) return;

            // 3. Map original blocks for reference
            const blockMap = new Map();
            originalBlocks.forEach((block, idx) => {
                // Ensure we have a valid identifier
                let fileName = block.getAttribute('file_name');
                if (!fileName) {
                    // Fallback try to find text
                    fileName = block.textContent.trim();
                }
                if (fileName) blockMap.set(fileName, block);

                // CRITICAL: Hide original blocks instead of moving them
                block.style.display = 'none';
                block.classList.add('tmc_hidden_original');
            });

            // 4. Check/Create our Shadow Container
            let shadowContainer = container.querySelector('#tmc_shadow_container');
            if (shadowContainer) {
                shadowContainer.innerHTML = ''; // Wipe clean for rebuild
            } else {
                shadowContainer = document.createElement('div');
                shadowContainer.id = 'tmc_shadow_container';
                // Insert at the top
                container.prepend(shadowContainer);
            }

            // 5. Get Folder Data
            const folders = getFoldersForCurrentCharacter();
            const AssignedFiles = new Set();

            // 6. Build Folders
            folders.forEach(folder => {
                const folderDiv = document.createElement('div');
                folderDiv.className = 'tmc_folder_row';

                // Header
                const header = document.createElement('div');
                header.className = 'tmc_header';
                header.innerHTML = `
                    <span class="tmc_toggle" data-parent="${folder.id}">${folder.collapsed ? '▶' : '▼'}</span>
                    <span class="tmc_icon">📁</span>
                    <span class="tmc_name">${escapeHtml(folder.name)}</span>
                    <span class="tmc_count">${folder.chats?.length || 0}</span>
                    <div class="tmc_actions">
                        <span class="tmc_btn tmc_edit" title="Rename">✏️</span>
                        <span class="tmc_btn tmc_delete" title="Delete">🗑️</span>
                    </div>
                `;

                // Header Events
                header.addEventListener('click', (e) => {
                    if (!e.target.closest('.tmc_btn')) toggleFolderCollapse(folder.id);
                });
                header.querySelector('.tmc_edit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const name = prompt('Rename folder:', folder.name);
                    if (name) renameFolder(folder.id, name);
                });
                header.querySelector('.tmc_delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${folder.name}"?`)) deleteFolder(folder.id);
                });

                folderDiv.appendChild(header);

                // Content
                const content = document.createElement('div');
                content.className = 'tmc_content';
                content.dataset.parent = folder.id;
                content.style.display = folder.collapsed ? 'none' : 'block';

                // Populate with Clones
                (folder.chats || []).forEach(fileName => {
                    const original = blockMap.get(fileName);
                    if (original) {
                        AssignedFiles.add(fileName);
                        content.appendChild(createCloneItem(original, fileName));
                    }
                });

                folderDiv.appendChild(content);
                shadowContainer.appendChild(folderDiv);
            });

            // 7. Be Uncategorized
            const uncatDiv = document.createElement('div');
            uncatDiv.className = 'tmc_folder_row tmc_uncat';

            const uncatHeader = document.createElement('div');
            uncatHeader.className = 'tmc_header tmc_uncat_header';
            uncatHeader.innerHTML = `
                <span class="tmc_icon">📄</span>
                <span class="tmc_name">Uncategorized</span>
                <span class="tmc_count"></span> 
            `;
            uncatDiv.appendChild(uncatHeader);

            const uncatContent = document.createElement('div');
            uncatContent.className = 'tmc_content';

            let uncatCount = 0;
            blockMap.forEach((block, fileName) => {
                if (!AssignedFiles.has(fileName)) {
                    uncatContent.appendChild(createCloneItem(block, fileName));
                    uncatCount++;
                }
            });
            uncatHeader.querySelector('.tmc_count').textContent = uncatCount;

            if (uncatCount > 0) {
                uncatDiv.appendChild(uncatContent);
                shadowContainer.appendChild(uncatDiv);
            } else if (folders.length === 0) {
                // Empty state (no folders, no uncat?) - rare, but show something
            }

            // 8. Add Header Button (Manage)
            injectManageButton(popup);

        } catch (err) {
            console.error('[Too Many Chats] Build Error:', err);
        } finally {
            isRebuilding = false;
        }
    }

    function createCloneItem(originalBlock, fileName) {
        // Clone the visual look
        const clone = originalBlock.cloneNode(true);
        clone.classList.remove('tmc_hidden_original');
        clone.classList.add('tmc_clone_item');
        clone.style.display = 'flex'; // Ensure visible

        // Hijack Click: Clicking clone clicks original
        clone.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            originalBlock.click();
        });

        // Hijack Context Menu
        clone.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, fileName);
        });

        return clone;
    }

    function injectManageButton(popup) {
        const title = popup.querySelector('h3, .popup_title');
        if (!title || title.querySelector('.tmc_add_btn')) return;

        const btn = document.createElement('span');
        btn.className = 'tmc_add_btn';
        btn.innerHTML = ' <i class="fa-solid fa-folder-plus"></i> ';
        btn.title = 'Create Folder';
        btn.style.cursor = 'pointer';
        btn.style.marginLeft = '10px';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = prompt('New Folder Name:');
            if (name) createFolder(name);
        });

        title.appendChild(btn);
    }

    function showContextMenu(e, fileName) {
        document.querySelectorAll('.tmc_ctx').forEach(el => el.remove());

        const folders = getFoldersForCurrentCharacter();
        const currentFolder = getChatFolder(fileName);

        const menu = document.createElement('div');
        menu.className = 'tmc_ctx';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';

        let html = `<div class="tmc_ctx_head">Move "${fileName}" to:</div>`;

        folders.forEach(f => {
            const active = f.id === currentFolder ? 'active' : '';
            html += `<div class="tmc_ctx_item ${active}" data-id="${f.id}">📁 ${escapeHtml(f.name)}</div>`;
        });

        const uncatActive = !currentFolder ? 'active' : '';
        html += `<div class="tmc_ctx_sep"></div>`;
        html += `<div class="tmc_ctx_item ${uncatActive}" data-id="uncategorized">📄 Uncategorized</div>`;
        html += `<div class="tmc_ctx_sep"></div>`;
        html += `<div class="tmc_ctx_item tmc_ctx_new">➕ New Folder</div>`;

        menu.innerHTML = html;
        document.body.appendChild(menu);

        menu.querySelectorAll('.tmc_ctx_item').forEach(item => {
            item.addEventListener('click', () => {
                if (item.classList.contains('tmc_ctx_new')) {
                    const name = prompt('New Folder:');
                    if (name) {
                        const fid = createFolder(name);
                        if (fid) moveChatToFolder(fileName, fid);
                    }
                } else {
                    moveChatToFolder(fileName, item.dataset.id);
                }
                menu.remove();
            });
        });

        // Click outside to close
        setTimeout(() => {
            document.addEventListener('click', function close(ev) {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('click', close);
                }
            });
        }, 100);
    }

    // ========== OBSERVER ==========

    function initObserver() {
        // Watch for Popup visibility AND content changes
        const observer = new MutationObserver((mutations) => {
            // If our container is gone, or original blocks appeared, we need to rebuild
            let needRebuild = false;

            // Check if user opened popup
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (popup && popup.style.display !== 'none') {
                // Check if our shadow container exists
                const shadow = document.getElementById('tmc_shadow_container');
                if (!shadow) {
                    needRebuild = true;
                } else {
                    // Check if original blocks became visible (ST re-rendered)
                    // If we find a block that is NOT our clone and IS visible -> ST wiped us/reset
                    const visibleOriginals = Array.from(popup.querySelectorAll('.select_chat_block:not(.tmc_clone_item)'))
                        .filter(el => el.style.display !== 'none');

                    if (visibleOriginals.length > 0) {
                        needRebuild = true;
                    }
                }
            }

            if (needRebuild) triggerRebuild();
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    }

    // ========== INIT ==========

    async function init() {
        const context = SillyTavern.getContext();
        initObserver();

        // Also hook event
        context.eventSource.on(context.event_types.CHAT_CHANGED, triggerRebuild);

        console.log(`[${EXTENSION_NAME}] v1.3.0 - Shadow View Active`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
