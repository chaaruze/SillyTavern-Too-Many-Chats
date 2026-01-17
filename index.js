/**
 * Too Many Chats - SillyTavern Extension
 * Organizes chats per character into collapsible folders
 * @author chaaruze
 * @version 1.2.0
 */

(function () {
    'use strict';

    const MODULE_NAME = 'chat_folders';
    const EXTENSION_NAME = 'Too Many Chats';

    const defaultSettings = Object.freeze({
        folders: {},
        characterFolders: {},
        version: '1.2.1'
    });

    let isProcessing = false;
    let lastProcessTime = 0;

    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function getSettings() {
        const context = SillyTavern.getContext();
        const { extensionSettings } = context;

        if (!extensionSettings[MODULE_NAME]) {
            extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
        }

        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
                extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
            }
        }

        return extensionSettings[MODULE_NAME];
    }

    function saveSettings() {
        const context = SillyTavern.getContext();
        context.saveSettingsDebounced();
    }

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

    // ========== FOLDER MANAGEMENT ==========

    function createFolder(name) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) {
            toastr.warning('Please select a character first');
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
        toastr.success(`Folder "${name}" created`);
        return folderId;
    }

    function renameFolder(folderId, newName) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].name = newName;
            saveSettings();
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
    }

    function toggleFolderCollapse(folderId) {
        const settings = getSettings();
        if (settings.folders[folderId]) {
            settings.folders[folderId].collapsed = !settings.folders[folderId].collapsed;
            saveSettings();

            // Update UI directly without full rebuild
            const section = document.querySelector(`.tmc_folder[data-folder-id="${folderId}"]`);
            if (section) {
                const toggle = section.querySelector('.tmc_toggle');
                const content = section.querySelector('.tmc_content');
                const isCollapsed = settings.folders[folderId].collapsed;
                if (toggle) toggle.textContent = isCollapsed ? '▶' : '▼';
                if (content) content.style.display = isCollapsed ? 'none' : '';
            }
        }
    }

    function moveChatToFolder(chatFileName, targetFolderId) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return;

        // Remove from all folders
        const charFolderIds = settings.characterFolders[characterId] || [];
        for (const fid of charFolderIds) {
            if (settings.folders[fid]?.chats) {
                const idx = settings.folders[fid].chats.indexOf(chatFileName);
                if (idx > -1) {
                    settings.folders[fid].chats.splice(idx, 1);
                }
            }
        }

        // Add to target folder
        if (targetFolderId && targetFolderId !== 'uncategorized' && settings.folders[targetFolderId]) {
            if (!settings.folders[targetFolderId].chats) {
                settings.folders[targetFolderId].chats = [];
            }
            settings.folders[targetFolderId].chats.push(chatFileName);
        }

        saveSettings();

        // Force rebuild by resetting flag
        const popup = document.querySelector('#shadow_select_chat_popup');
        if (popup) {
            popup.dataset.tmcProcessed = 'false';
        }
        // Delay to let any observer-triggered changes settle first
        setTimeout(() => processPopup(), 50);
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

    function getChatFolder(chatFileName) {
        const settings = getSettings();
        const characterId = getCurrentCharacterId();
        if (!characterId) return null;

        const folderIds = settings.characterFolders[characterId] || [];
        for (const fid of folderIds) {
            if (settings.folders[fid]?.chats?.includes(chatFileName)) {
                return fid;
            }
        }
        return null;
    }

    // ========== UI PROCESSING ==========

    function processPopup() {
        // Throttle processing
        const now = Date.now();
        if (isProcessing || now - lastProcessTime < 200) {
            return;
        }
        isProcessing = true;
        lastProcessTime = now;

        try {
            // Find the chat history popup
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (!popup || popup.style.display === 'none') {
                isProcessing = false;
                return;
            }

            // Find all chat blocks - these have the class .select_chat_block
            const chatBlocks = Array.from(popup.querySelectorAll('.select_chat_block'));
            if (chatBlocks.length === 0) {
                isProcessing = false;
                return;
            }

            const characterId = getCurrentCharacterId();
            if (!characterId) {
                isProcessing = false;
                return;
            }

            // Check if we already processed this popup
            if (popup.dataset.tmcProcessed === 'true') {
                isProcessing = false;
                return;
            }

            const folders = getFoldersForCurrentCharacter();

            // Remove any existing TMC elements
            popup.querySelectorAll('.tmc_folder, .tmc_uncategorized, .tmc_header_btn').forEach(el => el.remove());

            // Reset display on all chat blocks
            chatBlocks.forEach(block => {
                block.style.display = '';
                block.removeAttribute('data-tmc-assigned');
            });

            // If no folders, just add manage button and context menus
            if (folders.length === 0) {
                addHeaderButton(popup);
                addContextMenus(chatBlocks);
                popup.dataset.tmcProcessed = 'true';
                isProcessing = false;
                return;
            }

            // Get the container for chat blocks
            const container = chatBlocks[0].parentElement;
            if (!container) {
                isProcessing = false;
                return;
            }

            // Build a map: chat file name → chat block
            const chatMap = new Map();
            chatBlocks.forEach(block => {
                // Extract file name from the block - it's usually in the first child or has a data attribute
                // Looking at ST's structure, it stores file_name attribute on the element
                const fileName = block.getAttribute('file_name');
                if (fileName) {
                    chatMap.set(fileName, block);
                }
            });

            // If no file_name attributes found, try alternative method
            if (chatMap.size === 0) {
                // Try extracting from text content or other attributes
                chatBlocks.forEach((block, index) => {
                    // Use the block's text content as identifier
                    const textContent = block.querySelector('.select_chat_block_filename')?.textContent?.trim();
                    if (textContent) {
                        chatMap.set(textContent, block);
                    } else {
                        // Fallback: use index
                        chatMap.set(`chat_${index}`, block);
                    }
                });
            }

            const assignedChats = new Set();
            const folderFragment = document.createDocumentFragment();

            // Create folder sections
            folders.forEach(folder => {
                const section = document.createElement('div');
                section.className = 'tmc_folder';
                section.dataset.folderId = folder.id;

                const header = document.createElement('div');
                header.className = 'tmc_header';
                header.innerHTML = `
                    <span class="tmc_toggle">${folder.collapsed ? '▶' : '▼'}</span>
                    <span class="tmc_icon">📁</span>
                    <span class="tmc_name">${escapeHtml(folder.name)}</span>
                    <span class="tmc_count">${folder.chats?.length || 0}</span>
                    <span class="tmc_actions">
                        <span class="tmc_edit" title="Rename">✏️</span>
                        <span class="tmc_delete" title="Delete">🗑️</span>
                    </span>
                `;

                header.addEventListener('click', (e) => {
                    if (!e.target.classList.contains('tmc_edit') && !e.target.classList.contains('tmc_delete')) {
                        toggleFolderCollapse(folder.id);
                    }
                });

                header.querySelector('.tmc_edit').addEventListener('click', (e) => {
                    e.stopPropagation();
                    const name = prompt('Rename folder:', folder.name);
                    if (name?.trim()) {
                        renameFolder(folder.id, name.trim());
                        popup.dataset.tmcProcessed = 'false';
                        processPopup();
                    }
                });

                header.querySelector('.tmc_delete').addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Delete folder "${folder.name}"?`)) {
                        deleteFolder(folder.id);
                        popup.dataset.tmcProcessed = 'false';
                        processPopup();
                    }
                });

                section.appendChild(header);

                const content = document.createElement('div');
                content.className = 'tmc_content';
                if (folder.collapsed) content.style.display = 'none';

                // Move chats into this folder
                (folder.chats || []).forEach(chatFile => {
                    const block = chatMap.get(chatFile);
                    if (block) {
                        assignedChats.add(chatFile);
                        block.setAttribute('data-tmc-assigned', folder.id);
                        content.appendChild(block);
                    }
                });

                section.appendChild(content);
                folderFragment.appendChild(section);
            });

            // Create uncategorized section
            const uncatBlocks = Array.from(chatMap.entries()).filter(([file]) => !assignedChats.has(file));
            if (uncatBlocks.length > 0) {
                const uncatSection = document.createElement('div');
                uncatSection.className = 'tmc_folder tmc_uncategorized';

                const uncatHeader = document.createElement('div');
                uncatHeader.className = 'tmc_header tmc_uncat_header';
                uncatHeader.innerHTML = `
                    <span class="tmc_icon">📄</span>
                    <span class="tmc_name">Uncategorized</span>
                    <span class="tmc_count">${uncatBlocks.length}</span>
                `;

                uncatSection.appendChild(uncatHeader);

                const uncatContent = document.createElement('div');
                uncatContent.className = 'tmc_content';
                uncatBlocks.forEach(([, block]) => {
                    block.setAttribute('data-tmc-assigned', 'uncategorized');
                    uncatContent.appendChild(block);
                });

                uncatSection.appendChild(uncatContent);
                folderFragment.appendChild(uncatSection);
            }

            // Insert folder structure
            container.prepend(folderFragment);

            // Add header button and context menus
            addHeaderButton(popup);
            addContextMenus(chatBlocks);

            popup.dataset.tmcProcessed = 'true';

        } catch (error) {
            console.error('[Too Many Chats] Error processing popup:', error);
        } finally {
            isProcessing = false;
        }
    }

    function addHeaderButton(popup) {
        if (popup.querySelector('.tmc_header_btn')) return;

        const title = popup.querySelector('h3, .popup_title');
        if (!title) return;

        const btn = document.createElement('span');
        btn.className = 'tmc_header_btn';
        btn.textContent = ' 📁+';
        btn.title = 'Create New Folder';
        btn.style.cssText = 'cursor:pointer;margin-left:8px;';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = prompt('New folder name:');
            if (name?.trim()) {
                createFolder(name.trim());
                popup.dataset.tmcProcessed = 'false';
                processPopup();
            }
        });

        title.appendChild(btn);
    }

    function addContextMenus(blocks) {
        blocks.forEach(block => {
            block.addEventListener('contextmenu', handleContextMenu, { capture: true });
        });
    }

    function handleContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();

        const block = e.currentTarget;
        const fileName = block.getAttribute('file_name') ||
            block.querySelector('.select_chat_block_filename')?.textContent?.trim();
        if (!fileName) return;

        // Remove any existing menu
        document.querySelectorAll('.tmc_menu').forEach(m => m.remove());

        const folders = getFoldersForCurrentCharacter();
        const currentFolder = getChatFolder(fileName);

        const menu = document.createElement('div');
        menu.className = 'tmc_menu';
        menu.style.cssText = `
            position:fixed;
            left:${e.clientX}px;
            top:${e.clientY}px;
            background:var(--SmartThemeBlurTintColor,#1a1a2e);
            border:1px solid var(--SmartThemeBorderColor,#444);
            border-radius:8px;
            padding:8px 0;
            z-index:999999;
            min-width:160px;
            box-shadow:0 4px 20px rgba(0,0,0,0.5);
        `;

        let html = '<div style="padding:6px 14px;font-size:11px;color:#888;text-transform:uppercase;">Move to:</div>';

        folders.forEach(f => {
            const active = currentFolder === f.id;
            html += `<div class="tmc_menu_item" data-folder="${f.id}" style="padding:8px 14px;cursor:pointer;color:${active ? '#fff' : '#ccc'};${active ? 'background:rgba(255,255,255,0.08);' : ''}">
                📁 ${escapeHtml(f.name)}${active ? ' ✓' : ''}</div>`;
        });

        html += '<div style="height:1px;background:#333;margin:4px 0;"></div>';
        html += `<div class="tmc_menu_item" data-folder="uncategorized" style="padding:8px 14px;cursor:pointer;color:${!currentFolder ? '#fff' : '#ccc'};${!currentFolder ? 'background:rgba(255,255,255,0.08);' : ''}">
            📄 Uncategorized${!currentFolder ? ' ✓' : ''}</div>`;
        html += '<div style="height:1px;background:#333;margin:4px 0;"></div>';
        html += '<div class="tmc_menu_item tmc_menu_new" style="padding:8px 14px;cursor:pointer;color:#888;">📁+ New Folder...</div>';

        menu.innerHTML = html;
        document.body.appendChild(menu);

        menu.querySelectorAll('.tmc_menu_item').forEach(item => {
            item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.1)');
            item.addEventListener('mouseleave', () => {
                const isActive = item.textContent.includes('✓');
                item.style.background = isActive ? 'rgba(255,255,255,0.08)' : '';
            });
            item.addEventListener('click', () => {
                if (item.classList.contains('tmc_menu_new')) {
                    const name = prompt('New folder name:');
                    if (name?.trim()) {
                        const folderId = createFolder(name.trim());
                        if (folderId) {
                            moveChatToFolder(fileName, folderId);
                        }
                    }
                } else {
                    moveChatToFolder(fileName, item.dataset.folder);
                }
                menu.remove();
            });
        });

        // Close on outside click
        setTimeout(() => {
            const closeHandler = (ev) => {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 0);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== OBSERVER ==========

    function setupObserver() {
        let observerTimeout = null;

        const observer = new MutationObserver((mutations) => {
            // Skip if we're currently processing or recently processed
            if (isProcessing) return;

            // Check if any mutations affect our popup
            let shouldProcess = false;

            for (const mutation of mutations) {
                // Skip mutations from our own elements
                if (mutation.target.closest?.('.tmc_folder, .tmc_menu')) continue;

                // Check if the chat popup became visible
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    if (mutation.target.id === 'shadow_select_chat_popup') {
                        mutation.target.dataset.tmcProcessed = 'false';
                        shouldProcess = true;
                        break;
                    }
                }

                // Check for popup or chat blocks being added
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        // Skip our own elements
                        if (node.classList?.contains('tmc_folder') || node.classList?.contains('tmc_menu')) continue;

                        if (node.id === 'shadow_select_chat_popup') {
                            shouldProcess = true;
                            break;
                        }
                    }
                }
                if (shouldProcess) break;
            }

            if (shouldProcess) {
                // Debounce observer-triggered processing
                clearTimeout(observerTimeout);
                observerTimeout = setTimeout(() => {
                    const popup = document.querySelector('#shadow_select_chat_popup');
                    if (popup && popup.dataset.tmcProcessed !== 'true') {
                        processPopup();
                    }
                }, 150);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style']
        });
    }

    // ========== INITIALIZATION ==========

    async function init() {
        const context = SillyTavern.getContext();
        const { eventSource, event_types } = context;

        getSettings();
        setupObserver();

        eventSource.on(event_types.CHAT_CHANGED, () => {
            const popup = document.querySelector('#shadow_select_chat_popup');
            if (popup) popup.dataset.tmcProcessed = 'false';
            setTimeout(processPopup, 200);
        });

        // Initial delayed check
        setTimeout(processPopup, 1000);

        console.log(`[${EXTENSION_NAME}] v1.2.0 loaded successfully!`);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
