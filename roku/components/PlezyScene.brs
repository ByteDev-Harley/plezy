sub init()
    m.welcomeView = m.top.FindNode("welcomeView")
    m.browseView = m.top.FindNode("browseView")
    m.detailsView = m.top.FindNode("detailsView")
    m.providerButtons = m.top.FindNode("providerButtons")
    m.navList = m.top.FindNode("navList")
    m.mediaGrid = m.top.FindNode("mediaGrid")
    m.pageTitle = m.top.FindNode("pageTitle")
    m.pageSubtitle = m.top.FindNode("pageSubtitle")
    m.emptyMessage = m.top.FindNode("emptyMessage")
    m.serverName = m.top.FindNode("serverName")
    m.backdrop = m.top.FindNode("backdrop")
    m.detailBackdrop = m.top.FindNode("detailBackdrop")
    m.detailPoster = m.top.FindNode("detailPoster")
    m.detailTitle = m.top.FindNode("detailTitle")
    m.detailMeta = m.top.FindNode("detailMeta")
    m.detailSummary = m.top.FindNode("detailSummary")
    m.detailButtons = m.top.FindNode("detailButtons")
    m.video = m.top.FindNode("video")
    m.spinner = m.top.FindNode("spinner")
    m.loadingText = m.top.FindNode("loadingText")
    m.plexPinTimer = m.top.FindNode("plexPinTimer")
    m.progressTimer = m.top.FindNode("progressTimer")
    m.apiTask = m.top.FindNode("apiTask")
    m.progressTask = m.top.FindNode("progressTask")

    m.apiRequestCounter = 0
    m.progressRequestCounter = 0
    m.apiBusy = false
    m.progressBusy = false
    m.loadingShown = false
    m.pendingCommand = ""
    m.pendingContext = ""
    m.session = invalid
    m.libraries = []
    m.currentItems = []
    m.currentDetail = invalid
    m.playback = invalid
    m.directFallbackTried = false
    m.resumeSeekPending = false
    m.playbackClosing = false
    m.queuedStopProgress = false
    m.progressLastState = ""
    m.pinId = ""
    m.pinPolls = 0
    m.keyboardPurpose = ""
    m.jellyfinForm = {}

    SetDialogPalette()
    SetNavigationContent()

    m.providerButtons.ObserveField("buttonSelected", "onProviderSelected")
    m.navList.ObserveField("itemSelected", "onNavSelected")
    m.mediaGrid.ObserveField("itemSelected", "onMediaSelected")
    m.mediaGrid.ObserveField("itemFocused", "onMediaFocused")
    m.detailButtons.ObserveField("buttonSelected", "onDetailButtonSelected")
    m.apiTask.ObserveField("responseId", "onApiResponse")
    m.progressTask.ObserveField("responseId", "onProgressResponse")
    m.plexPinTimer.ObserveField("fire", "onPlexPinPoll")
    m.progressTimer.ObserveField("fire", "onProgressTick")
    m.video.ObserveField("state", "onVideoState")

    ShowLoading("Restoring your server...")
    RunApi("sessionLoad", {}, "startup", true)
end sub

sub SetDialogPalette()
    palette = CreateObject("roSGNode", "RSGPalette")
    palette.colors = {
        DialogBackgroundColor: "0x11151fff"
        DialogItemColor: "0xf5a623ff"
        DialogTextColor: "0xf4f6fbff"
        DialogFocusColor: "0xf5a623ff"
        DialogFocusItemColor: "0x090b10ff"
        DialogSecondaryTextColor: "0xaeb5c4ff"
        DialogSecondaryItemColor: "0x313747ff"
        DialogInputFieldColor: "0x212737ff"
        DialogKeyboardColor: "0x171c28ff"
        DialogFootprintColor: "0x747d90ff"
    }
    m.top.palette = palette
end sub

sub SetNavigationContent()
    root = CreateObject("roSGNode", "ContentNode")
    for each title in ["Home", "Libraries", "Search", "Settings"]
        node = root.CreateChild("ContentNode")
        node.title = title
    end for
    m.navList.content = root
end sub

sub ShowLoading(message as String)
    m.loadingText.text = message
    m.loadingText.visible = true
    m.spinner.visible = true
    m.spinner.control = "start"
    m.loadingShown = true
end sub

sub HideLoading()
    m.spinner.control = "stop"
    m.spinner.visible = false
    m.loadingText.visible = false
    m.loadingShown = false
end sub

sub RunApi(command as String, payload as Object, context = "" as String, showBusy = true as Boolean)
    if m.apiBusy then return
    m.apiBusy = true
    m.pendingCommand = command
    m.pendingContext = context
    if showBusy then ShowLoading(LoadingMessage(command))

    m.apiRequestCounter = m.apiRequestCounter + 1
    m.apiTask.command = command
    m.apiTask.payload = payload
    m.apiTask.requestId = m.apiRequestCounter
    m.apiTask.control = "run"
end sub

function LoadingMessage(command as String) as String
    if command = "plexCreatePin" then return "Starting Plex sign-in..."
    if command = "plexServers" then return "Finding your Plex servers..."
    if command = "jellyfinLogin" then return "Signing in to Jellyfin..."
    if command = "sessionSave" then return "Saving your server..."
    if command = "sessionClear" then return "Signing out..."
    if command = "libraries" then return "Loading libraries..."
    if command = "libraryItems" then return "Loading library..."
    if command = "search" then return "Searching..."
    if command = "details" then return "Loading details..."
    if command = "children" then return "Loading episodes..."
    if command = "playback" then return "Preparing playback..."
    return "Loading your media..."
end function

sub onApiResponse()
    if m.apiTask.responseId <> m.apiRequestCounter then return

    response = m.apiTask.response
    command = m.pendingCommand
    context = m.pendingContext
    m.apiBusy = false
    m.pendingCommand = ""
    m.pendingContext = ""
    if m.loadingShown then HideLoading()

    if response = invalid or not response.ok then
        HandleApiError(command, response)
        return
    end if

    data = response.data
    if command = "sessionLoad" then
        HandleSessionLoad(data)
    else if command = "sessionSave" then
        RunApi("libraries", { session: m.session }, "startupLibraries", true)
    else if command = "sessionClear" then
        m.session = invalid
        m.libraries = []
        ShowWelcome()
    else if command = "plexCreatePin" then
        ShowPlexPin(data)
    else if command = "plexCheckPin" then
        HandlePlexPinCheck(data)
    else if command = "plexServers" then
        HandlePlexServers(data)
    else if command = "jellyfinLogin" then
        m.session = data
        RunApi("sessionSave", { session: m.session }, "connect", true)
    else if command = "libraries" then
        m.libraries = data
        if context = "startupLibraries" then
            EnterBrowse()
            LoadHome()
        else
            ShowLibraryPicker()
        end if
    else if command = "home" then
        ShowHomeResults(data)
    else if command = "libraryItems" then
        ShowItems(data, m.pageTitle.text, "Library")
    else if command = "search" then
        ShowItems(data, "Search", "Results for """ + context + """")
    else if command = "details" then
        ShowDetails(data)
    else if command = "children" then
        title = response.label
        if title = "" then title = "Episodes"
        ShowItems(data, title, "Browse")
        CloseDetails()
    else if command = "playback" then
        StartPlayback(data)
    end if
end sub

sub HandleApiError(command as String, response as Dynamic)
    message = "Something went wrong."
    if response <> invalid and response.error <> invalid and response.error <> "" then message = response.error

    if command = "sessionLoad" then
        ShowWelcome()
        ShowError("Session restore failed", message)
    else if command = "libraries" and m.session <> invalid then
        ShowWelcome()
        ShowError("Server unavailable", message + " Check that the server is online, then connect again.")
    else if command = "plexCheckPin" then
        CancelPlexPin()
        ShowError("Plex sign-in failed", message)
    else
        ShowError("Plezy", message)
        RestoreFocus()
    end if
end sub

sub HandleSessionLoad(data as Dynamic)
    if data <> invalid and data.provider <> invalid and data.provider <> "" then
        m.session = data
        RunApi("libraries", { session: m.session }, "startupLibraries", true)
    else
        ShowWelcome()
    end if
end sub

sub ShowWelcome()
    HideLoading()
    m.plexPinTimer.control = "stop"
    m.progressTimer.control = "stop"
    m.video.visible = false
    m.detailsView.visible = false
    m.browseView.visible = false
    m.welcomeView.visible = true
    m.serverName.text = ""
    m.backdrop.uri = ""
    m.providerButtons.SetFocus(true)
end sub

sub EnterBrowse()
    m.welcomeView.visible = false
    m.detailsView.visible = false
    m.video.visible = false
    m.browseView.visible = true
    m.serverName.text = SessionName()
    m.navList.jumpToItem = 0
    m.navList.SetFocus(true)
end sub

function SessionName() as String
    if m.session = invalid then return ""
    if m.session.provider = "plex" then return StringValue(m.session.name, "Plex")
    return StringValue(m.session.serverName, "Jellyfin")
end function

function StringValue(value as Dynamic, fallback = "" as String) as String
    if value = invalid then return fallback
    return value.ToStr()
end function

sub onProviderSelected()
    index = m.providerButtons.buttonSelected
    if index = 0 then
        RunApi("plexCreatePin", {}, "connect", true)
    else if index = 1 then
        m.jellyfinForm = { baseUrl: "", username: "", password: "" }
        ShowKeyboard("jellyfinUrl", "Jellyfin server address", "Example: http://192.168.1.25:8096", "", "generic", false)
    end if
end sub

sub ShowPlexPin(data as Object)
    m.pinId = data.id
    m.pinPolls = 0

    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = "Connect Plex"
    dialog.message = [
        "On a phone or computer, open https://plex.tv/link"
        "Enter this code: " + data.code
        "Plezy will continue automatically after Plex approves this Roku."
    ]
    dialog.buttons = ["Cancel"]
    dialog.ObserveField("buttonSelected", "onDialogButtonSelected")
    m.dialogPurpose = "plexPin"
    m.activeDialog = dialog
    m.top.dialog = dialog
    m.plexPinTimer.control = "start"
end sub

sub onPlexPinPoll()
    if m.pinId = "" or m.apiBusy then return
    m.pinPolls = m.pinPolls + 1
    if m.pinPolls > 300 then
        CancelPlexPin()
        ShowError("Plex sign-in expired", "The link code expired after 10 minutes. Start Plex sign-in again.")
        return
    end if
    RunApi("plexCheckPin", { pinId: m.pinId }, "pin", false)
end sub

sub HandlePlexPinCheck(data as Object)
    if data.pending then return
    if data.token = invalid or data.token = "" then return

    token = data.token
    CancelPlexPin()
    RunApi("plexServers", { token: token }, "connect", true)
end sub

sub CancelPlexPin()
    m.plexPinTimer.control = "stop"
    m.pinId = ""
    m.pinPolls = 0
    if m.activeDialog <> invalid then m.activeDialog.close = true
    m.activeDialog = invalid
    m.dialogPurpose = ""
end sub

sub HandlePlexServers(servers as Object)
    if servers.Count() = 1 then
        ConnectPlexServer(servers[0])
        return
    end if

    buttons = []
    for each server in servers
        buttons.Push(server.name)
    end for
    buttons.Push("Cancel")

    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = "Choose a Plex server"
    dialog.message = ["Select the server Plezy should use on this Roku."]
    dialog.buttons = buttons
    dialog.ObserveField("buttonSelected", "onDialogButtonSelected")
    m.serverOptions = servers
    m.dialogPurpose = "plexServers"
    m.activeDialog = dialog
    m.top.dialog = dialog
end sub

sub ConnectPlexServer(server as Object)
    m.session = {
        provider: "plex"
        id: server.id
        name: server.name
        owned: server.owned
        token: server.token
        baseUrl: server.baseUrl
    }
    RunApi("sessionSave", { session: m.session }, "connect", true)
end sub

sub ShowKeyboard(purpose as String, title as String, helpText as String, initialText as String, domain as String, secure as Boolean)
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = title
    if helpText <> "" then dialog.message = [helpText]
    dialog.buttons = ["Continue", "Cancel"]
    dialog.text = initialText
    dialog.keyboardDomain = domain
    if secure then dialog.textEditBox.secureMode = true
    dialog.ObserveField("buttonSelected", "onKeyboardButtonSelected")
    m.keyboardPurpose = purpose
    m.keyboardDialog = dialog
    m.top.dialog = dialog
end sub

sub onKeyboardButtonSelected()
    if m.keyboardDialog = invalid then return
    selected = m.keyboardDialog.buttonSelected
    value = m.keyboardDialog.text
    purpose = m.keyboardPurpose
    m.keyboardDialog.close = true
    m.keyboardDialog = invalid
    m.keyboardPurpose = ""

    if selected <> 0 then
        RestoreFocus()
        return
    end if

    if purpose = "jellyfinUrl" then
        m.jellyfinForm.baseUrl = value
        ShowKeyboard("jellyfinUser", "Jellyfin username", "", "", "generic", false)
    else if purpose = "jellyfinUser" then
        m.jellyfinForm.username = value
        ShowKeyboard("jellyfinPassword", "Jellyfin password", "Leave blank if this user has no password.", "", "password", true)
    else if purpose = "jellyfinPassword" then
        m.jellyfinForm.password = value
        RunApi("jellyfinLogin", m.jellyfinForm, "connect", true)
    else if purpose = "search" then
        term = value.Trim()
        if term <> "" then RunApi("search", { session: m.session, term: term }, term, true)
    end if
end sub

sub onNavSelected()
    index = m.navList.itemSelected
    if index = 0 then
        LoadHome()
    else if index = 1 then
        if m.libraries.Count() > 0 then
            ShowLibraryPicker()
        else
            RunApi("libraries", { session: m.session }, "libraryPicker", true)
        end if
    else if index = 2 then
        ShowKeyboard("search", "Search your server", "Search movies, shows, and episodes.", "", "generic", false)
    else if index = 3 then
        ShowSettings()
    end if
end sub

sub LoadHome()
    RunApi("home", { session: m.session }, "home", true)
end sub

sub ShowHomeResults(shelves as Object)
    items = []
    names = []
    for each shelf in shelves
        names.Push(shelf.title)
        for each item in shelf.items
            item.shelfTitle = shelf.title
            items.Push(item)
        end for
    end for
    subtitle = names.Join("  /  ")
    if subtitle = "" then subtitle = "Your server has no home recommendations yet."
    ShowItems(items, "Home", subtitle)
end sub

sub ShowLibraryPicker()
    if m.libraries.Count() = 0 then
        ShowError("Libraries", "No supported media libraries were returned by this server.")
        return
    end if

    buttons = []
    for each library in m.libraries
        buttons.Push(library.title)
    end for
    buttons.Push("Cancel")

    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = "Libraries"
    dialog.message = ["Choose a library to browse."]
    dialog.buttons = buttons
    dialog.ObserveField("buttonSelected", "onDialogButtonSelected")
    m.dialogPurpose = "libraries"
    m.activeDialog = dialog
    m.top.dialog = dialog
end sub

sub ShowSettings()
    provider = "Plex"
    if m.session <> invalid and m.session.provider = "jellyfin" then provider = "Jellyfin"

    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = "Settings"
    dialog.message = [
        "Connected to " + SessionName() + " with " + provider + "."
        "Signing out removes the saved server token from this Roku."
    ]
    dialog.buttons = ["Sign out", "Cancel"]
    dialog.ObserveField("buttonSelected", "onDialogButtonSelected")
    m.dialogPurpose = "settings"
    m.activeDialog = dialog
    m.top.dialog = dialog
end sub

sub onDialogButtonSelected()
    if m.activeDialog = invalid then return
    selected = m.activeDialog.buttonSelected
    purpose = m.dialogPurpose
    m.activeDialog.close = true
    m.activeDialog = invalid
    m.dialogPurpose = ""

    if purpose = "plexPin" then
        CancelPlexPin()
        ShowWelcome()
    else if purpose = "plexServers" then
        if selected < m.serverOptions.Count() then ConnectPlexServer(m.serverOptions[selected])
    else if purpose = "libraries" then
        if selected < m.libraries.Count() then
            library = m.libraries[selected]
            m.pageTitle.text = library.title
            RunApi("libraryItems", { session: m.session, libraryId: library.id }, library.title, true)
        end if
    else if purpose = "settings" then
        if selected = 0 then RunApi("sessionClear", {}, "signout", true)
    end if
end sub

sub ShowItems(items as Object, title as String, subtitle as String)
    m.currentItems = items
    m.pageTitle.text = title
    m.pageSubtitle.text = subtitle
    m.detailsView.visible = false
    m.browseView.visible = true

    root = CreateObject("roSGNode", "ContentNode")
    for each item in items
        node = root.CreateChild("ContentNode")
        node.title = item.title
        node.HDPosterUrl = item.thumb
        node.Length = Int(item.durationMs / 1000)
        node.BookmarkPosition = Int(item.resumeMs / 1000)
        node.AddField("plezyData", "assocarray", false)
        node.plezyData = item
    end for
    m.mediaGrid.content = root
    m.emptyMessage.visible = items.Count() = 0
    m.backdrop.uri = ""

    if items.Count() > 0 then
        m.mediaGrid.jumpToItem = 0
        m.mediaGrid.SetFocus(true)
    else
        m.navList.SetFocus(true)
    end if
end sub

sub onMediaFocused()
    if m.mediaGrid.content = invalid or m.mediaGrid.content.GetChildCount() = 0 then return
    index = m.mediaGrid.itemFocused
    if index < 0 or index >= m.mediaGrid.content.GetChildCount() then return
    content = m.mediaGrid.content.GetChild(index)
    if content <> invalid and content.plezyData <> invalid then m.backdrop.uri = content.plezyData.art
end sub

sub onMediaSelected()
    if m.mediaGrid.content = invalid then return
    index = m.mediaGrid.itemSelected
    if index < 0 or index >= m.mediaGrid.content.GetChildCount() then return
    content = m.mediaGrid.content.GetChild(index)
    if content = invalid or content.plezyData = invalid then return
    RunApi("details", { session: m.session, itemId: content.plezyData.id }, "details", true)
end sub

sub ShowDetails(item as Object)
    m.currentDetail = item
    m.detailTitle.text = item.title
    meta = UCase(item.type)
    if item.year <> invalid and item.year > 0 then meta = meta + "  /  " + item.year.ToStr()
    if item.resumeMs <> invalid and item.resumeMs > 0 then meta = meta + "  /  RESUME"
    m.detailMeta.text = meta
    m.detailSummary.text = item.summary
    m.detailPoster.uri = item.thumb
    m.detailBackdrop.uri = item.art

    playButton = m.detailButtons.GetChild(0)
    browseButton = m.detailButtons.GetChild(1)
    playButton.visible = item.playable
    playButton.focusable = item.playable
    browseButton.visible = item.hasChildren
    browseButton.focusable = item.hasChildren

    m.browseView.visible = false
    m.detailsView.visible = true
    if item.playable or item.hasChildren then m.detailButtons.SetFocus(true)
end sub

sub CloseDetails()
    m.detailsView.visible = false
    m.browseView.visible = true
    m.mediaGrid.SetFocus(true)
end sub

sub onDetailButtonSelected()
    if m.currentDetail = invalid then return
    index = m.detailButtons.buttonSelected
    if index = 0 and m.currentDetail.playable then
        RunApi("playback", { session: m.session, item: m.currentDetail }, "playback", true)
    else if index = 1 and m.currentDetail.hasChildren then
        RunApi("children", { session: m.session, item: m.currentDetail }, "children", true)
    end if
end sub

sub StartPlayback(playback as Object)
    m.playback = playback
    m.directFallbackTried = false
    m.resumeSeekPending = false
    m.playbackClosing = false
    m.queuedStopProgress = false
    PlayUrl(playback.url, "hls")
end sub

sub PlayUrl(url as String, streamFormat as String)
    content = CreateObject("roSGNode", "ContentNode")
    content.url = url
    if streamFormat <> "" then content.streamFormat = streamFormat
    content.title = m.playback.item.title
    content.Length = Int(m.playback.durationMs / 1000)

    m.resumeSeekPending = streamFormat = "" and m.playback.startMs > 0

    m.video.content = content
    m.video.visible = true
    m.detailsView.visible = false
    m.browseView.visible = false
    m.video.SetFocus(true)
    m.video.control = "play"
    m.progressTimer.control = "start"
    SendProgress("playing")
end sub

sub onVideoState()
    state = m.video.state
    if state = "paused" then
        SendProgress("paused")
    else if state = "playing" then
        if m.resumeSeekPending then
            m.resumeSeekPending = false
            m.video.seek = Int(m.playback.startMs / 1000)
        end if
        SendProgress("playing")
    else if state = "finished" then
        StopPlayback(false)
    else if state = "error" then
        if m.playback <> invalid and not m.directFallbackTried and m.playback.directUrl <> invalid and m.playback.directUrl <> "" then
            m.directFallbackTried = true
            m.video.control = "stop"
            PlayUrl(m.playback.directUrl, "")
        else
            errorCode = m.video.errorCode
            StopPlayback(false)
            ShowError("Playback failed", "Roku could not play this stream (error " + errorCode.ToStr() + "). Check server transcoding and codec support.")
        end if
    end if
end sub

sub onProgressTick()
    SendProgress("playing")
end sub

sub SendProgress(state as String)
    if m.playback = invalid then return
    if m.progressBusy then
        if state = "stopped" then m.queuedStopProgress = true
        return
    end if
    m.progressBusy = true
    m.progressLastState = state
    m.progressRequestCounter = m.progressRequestCounter + 1
    m.progressTask.command = "progress"
    m.progressTask.payload = {
        session: m.session
        playback: m.playback
        positionMs: Int(m.video.position * 1000)
        state: state
    }
    m.progressTask.requestId = m.progressRequestCounter
    m.progressTask.control = "run"
end sub

sub onProgressResponse()
    if m.playback <> invalid and m.playback.provider = "jellyfin" and m.progressLastState <> "stopped" then
        m.playback.progressStarted = true
    end if
    m.progressBusy = false
    if m.queuedStopProgress then
        m.queuedStopProgress = false
        SendProgress("stopped")
    else if m.progressLastState = "stopped" and m.playbackClosing then
        m.playback = invalid
        m.playbackClosing = false
        m.detailButtons.visible = true
        if m.detailsView.visible then m.detailButtons.SetFocus(true)
    end if
end sub

sub StopPlayback(userInitiated as Boolean)
    if m.playback = invalid then return
    m.progressTimer.control = "stop"
    m.playbackClosing = true
    SendProgress("stopped")
    if userInitiated then m.video.control = "stop"
    m.video.visible = false
    m.detailsView.visible = true
    m.detailButtons.visible = false
end sub

sub ShowError(title as String, message as String)
    dialog = CreateObject("roSGNode", "StandardMessageDialog")
    dialog.title = title
    dialog.message = [message]
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "onErrorDismissed")
    m.errorDialog = dialog
    m.top.dialog = dialog
end sub

sub onErrorDismissed()
    if m.errorDialog <> invalid then m.errorDialog.close = true
    m.errorDialog = invalid
    RestoreFocus()
end sub

sub RestoreFocus()
    if m.video.visible then
        m.video.SetFocus(true)
    else if m.detailsView.visible and m.detailButtons.visible then
        m.detailButtons.SetFocus(true)
    else if m.browseView.visible then
        m.navList.SetFocus(true)
    else
        m.providerButtons.SetFocus(true)
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false

    if key = "back" then
        if m.video.visible then
            StopPlayback(true)
            return true
        else if m.detailsView.visible then
            CloseDetails()
            return true
        end if
        return false
    end if

    if m.browseView.visible then
        if key = "right" and m.navList.HasFocus() and m.currentItems.Count() > 0 then
            m.mediaGrid.SetFocus(true)
            return true
        else if key = "left" and m.mediaGrid.HasFocus() then
            index = m.mediaGrid.itemFocused
            if index Mod 6 = 0 then
                m.navList.SetFocus(true)
                return true
            end if
        end if
    end if

    return false
end function
