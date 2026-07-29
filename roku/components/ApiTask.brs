sub init()
    m.top.functionName = "runCommand"
end sub

sub runCommand()
    command = m.top.command
    payload = m.top.payload
    if payload = invalid then payload = {}

    result = DispatchCommand(command, payload)
    m.top.response = result
    m.top.responseId = m.top.requestId
end sub

function DispatchCommand(command as String, payload as Object) as Object
    if command = "plexCreatePin" then return PlexCreatePin()
    if command = "plexCheckPin" then return PlexCheckPin(payload)
    if command = "plexServers" then return PlexServers(payload)
    if command = "jellyfinLogin" then return JellyfinLogin(payload)
    if command = "sessionLoad" then return SessionLoad()
    if command = "sessionSave" then return SessionSave(payload)
    if command = "sessionClear" then return SessionClear()
    if command = "home" then return LoadHome(payload)
    if command = "libraries" then return LoadLibraries(payload)
    if command = "libraryItems" then return LoadLibraryItems(payload)
    if command = "search" then return SearchMedia(payload)
    if command = "details" then return LoadDetails(payload)
    if command = "children" then return LoadChildren(payload)
    if command = "playback" then return CreatePlayback(payload)
    if command = "progress" then return ReportProgress(payload)
    return Failure("Unknown API command: " + command)
end function

function SessionLoad() as Object
    section = CreateObject("roRegistrySection", "Plezy")
    if not section.Exists("Session") then return Success({})
    session = ParseJson(section.Read("Session"))
    if session = invalid then return Success({})
    return Success(session)
end function

function SessionSave(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    if session = invalid then return Failure("The server session could not be saved.")
    section = CreateObject("roRegistrySection", "Plezy")
    if not section.Write("Session", FormatJson(session)) then return Failure("Roku could not save the server session.")
    if not section.Flush() then return Failure("Roku could not finish saving the server session.")
    return Success(session)
end function

function SessionClear() as Object
    section = CreateObject("roRegistrySection", "Plezy")
    if section.Exists("Session") then section.Delete("Session")
    section.Flush()
    return Success({})
end function

function PlexCreatePin() as Object
    result = JsonRequest("https://plex.tv/api/v2/pins", "POST", PlexHeaders(), "")
    if not result.ok then return ApiFailure(result)
    pinId = StringOr(FieldOr(result.data, "id", ""))
    code = UCase(StringOr(FieldOr(result.data, "code", "")))
    if pinId = "" or Len(code) <> 4 then return Failure("Plex did not return a four-character TV link code.")
    return Success({
        id: pinId
        code: code
    })
end function

function PlexCheckPin(payload as Object) as Object
    pinId = StringOr(FieldOr(payload, "pinId", ""))
    if pinId = "" then return Failure("The Plex sign-in code is missing.")
    result = JsonRequest("https://plex.tv/api/v2/pins/" + UrlEscape(pinId), "GET", PlexHeaders())
    if not result.ok then return ApiFailure(result)
    token = StringOr(FieldOr(result.data, "authToken", ""))
    return Success({
        token: token
        pending: token = ""
    })
end function

function PlexServers(payload as Object) as Object
    token = StringOr(FieldOr(payload, "token", ""))
    if token = "" then return Failure("Plex did not provide an authentication token.")
    result = JsonRequest("https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1&includeIPv6=1", "GET", PlexHeaders(token))
    if not result.ok then return ApiFailure(result)

    servers = []
    for each resource in ArrayOr(result.data)
        provides = StringOr(FieldOr(resource, "provides", ""))
        if Instr(1, "," + provides + ",", ",server,") > 0 then
            connections = ArrayOr(FieldOr(resource, "connections", invalid))
            selected = invalid
            selectedScore = -1000
            for each connection in connections
                uri = StringOr(FieldOr(connection, "uri", ""))
                if uri <> "" then
                    score = 0
                    if BoolOr(FieldOr(connection, "local", false)) then score = score + 40
                    protocol = LCase(StringOr(FieldOr(connection, "protocol", "")))
                    if protocol = "https" or LCase(uri.Left(8)) = "https://" then score = score + 20
                    if BoolOr(FieldOr(connection, "relay", false)) then score = score - 10
                    if score > selectedScore then
                        selected = connection
                        selectedScore = score
                    end if
                end if
            end for

            if selected <> invalid then
                servers.Push({
                    id: StringOr(FieldOr(resource, "clientIdentifier", ""))
                    name: StringOr(FieldOr(resource, "name", "Plex server"))
                    owned: BoolOr(FieldOr(resource, "owned", true), true)
                    token: StringOr(FieldOr(resource, "accessToken", token))
                    baseUrl: TrimSlash(FieldOr(selected, "uri", ""))
                    provider: "plex"
                })
            end if
        end if
    end for

    if servers.Count() = 0 then return Failure("No reachable Plex Media Server was found for this account.")
    return Success(servers)
end function

function JellyfinLogin(payload as Object) as Object
    baseUrl = TrimSlash(FieldOr(payload, "baseUrl", ""))
    username = StringOr(FieldOr(payload, "username", ""))
    password = StringOr(FieldOr(payload, "password", ""))
    lowerUrl = LCase(baseUrl)
    if lowerUrl.Left(7) <> "http://" and lowerUrl.Left(8) <> "https://" then
        return Failure("The Jellyfin address must start with http:// or https://.")
    end if
    if username = "" then return Failure("Enter your Jellyfin username.")

    temporarySession = {
        provider: "jellyfin"
        baseUrl: baseUrl
        token: ""
        userId: ""
    }
    body = FormatJson({
        Username: username
        Pw: password
    })
    result = JsonRequest(JoinUrl(baseUrl, "/Users/AuthenticateByName"), "POST", JellyfinHeaders(temporarySession, true), body)
    if not result.ok then return ApiFailure(result)

    token = StringOr(FieldOr(result.data, "AccessToken", ""))
    user = FieldOr(result.data, "User", {})
    userId = StringOr(FieldOr(user, "Id", ""))
    if token = "" or userId = "" then return Failure("Jellyfin returned an incomplete sign-in response.")

    return Success({
        provider: "jellyfin"
        baseUrl: baseUrl
        token: token
        userId: userId
        serverName: StringOr(FieldOr(result.data, "ServerName", "Jellyfin"))
        serverId: StringOr(FieldOr(result.data, "ServerId", ""))
        username: StringOr(FieldOr(user, "Name", username))
    })
end function

function LoadLibraries(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    if session = invalid then return Failure("No server session is available.")

    libraries = []
    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/library/sections")
        if not result.ok then return ApiFailure(result)
        for each raw in ArrayOr(FieldOr(PlexContainer(result.data), "Directory", invalid))
            libraries.Push({
                id: StringOr(FieldOr(raw, "key", ""))
                title: StringOr(FieldOr(raw, "title", "Library"))
                type: StringOr(FieldOr(raw, "type", "library"))
            })
        end for
    else
        path = "/Users/" + UrlEscape(session.userId) + "/Views"
        result = JellyfinRequest(session, path)
        if not result.ok then return ApiFailure(result)
        for each raw in ArrayOr(FieldOr(result.data, "Items", invalid))
            collectionType = LCase(StringOr(FieldOr(raw, "CollectionType", "")))
            if collectionType = "movies" or collectionType = "tvshows" or collectionType = "music" or collectionType = "mixed" then
                libraries.Push({
                    id: StringOr(FieldOr(raw, "Id", ""))
                    title: StringOr(FieldOr(raw, "Name", "Library"))
                    type: collectionType
                })
            end if
        end for
    end if

    return Success(libraries)
end function

function LoadHome(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    if session = invalid then return Failure("No server session is available.")
    shelves = []

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/hubs/home", {
            includeMetadata: 1
            includeExternalMedia: 1
            count: 24
        })
        if not result.ok then return ApiFailure(result)
        for each hub in ArrayOr(FieldOr(PlexContainer(result.data), "Hub", invalid))
            values = FieldOr(hub, "Metadata", FieldOr(hub, "Directory", invalid))
            items = NormalizeItems(session, values)
            if items.Count() > 0 then
                shelves.Push({
                    id: StringOr(FieldOr(hub, "hubIdentifier", FieldOr(hub, "key", FieldOr(hub, "title", "media"))))
                    title: StringOr(FieldOr(hub, "title", "Media"))
                    items: items
                })
            end if
        end for
    else
        common = {
            Fields: "Overview,PrimaryImageAspectRatio,MediaSources"
            ImageTypeLimit: 1
            EnableImageTypes: "Primary,Backdrop"
            Limit: 24
        }
        resumeResult = JellyfinRequest(session, "/Users/" + UrlEscape(session.userId) + "/Items/Resume", common)
        if not resumeResult.ok then return ApiFailure(resumeResult)
        latestResult = JellyfinRequest(session, "/Users/" + UrlEscape(session.userId) + "/Items/Latest", common)
        if not latestResult.ok then return ApiFailure(latestResult)

        resumeItems = NormalizeItems(session, FieldOr(resumeResult.data, "Items", invalid))
        latestItems = NormalizeItems(session, latestResult.data)
        if resumeItems.Count() > 0 then shelves.Push({ id: "resume", title: "Continue Watching", items: resumeItems })
        if latestItems.Count() > 0 then shelves.Push({ id: "latest", title: "Recently Added", items: latestItems })
    end if

    return Success(shelves)
end function

function LoadLibraryItems(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    libraryId = StringOr(FieldOr(payload, "libraryId", ""))
    if session = invalid or libraryId = "" then return Failure("Choose a valid library.")

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/library/sections/" + UrlEscape(libraryId) + "/all", {
            includeCollections: 1
            includeMeta: 1
        })
        if not result.ok then return ApiFailure(result)
        container = PlexContainer(result.data)
        values = FieldOr(container, "Metadata", FieldOr(container, "Directory", invalid))
    else
        result = JellyfinRequest(session, "/Users/" + UrlEscape(session.userId) + "/Items", {
            ParentId: libraryId
            Recursive: "true"
            IncludeItemTypes: "Movie,Series"
            Fields: "Overview,PrimaryImageAspectRatio,MediaSources"
            EnableImageTypes: "Primary,Backdrop"
            ImageTypeLimit: 1
            SortBy: "SortName"
            SortOrder: "Ascending"
            Limit: 300
        })
        if not result.ok then return ApiFailure(result)
        values = FieldOr(result.data, "Items", invalid)
    end if

    return Success(NormalizeItems(session, values))
end function

function SearchMedia(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    term = StringOr(FieldOr(payload, "term", "")).Trim()
    if session = invalid or term = "" then return Failure("Enter a search term.")

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/hubs/search", { query: term, limit: 60 })
        if not result.ok then return ApiFailure(result)
        items = []
        seen = {}
        for each hub in ArrayOr(FieldOr(PlexContainer(result.data), "Hub", invalid))
            values = FieldOr(hub, "Metadata", FieldOr(hub, "Directory", invalid))
            for each item in NormalizeItems(session, values)
                if item.id <> "" and not seen.DoesExist(item.id) then
                    seen[item.id] = true
                    items.Push(item)
                end if
            end for
        end for
    else
        result = JellyfinRequest(session, "/Users/" + UrlEscape(session.userId) + "/Items", {
            SearchTerm: term
            Recursive: "true"
            IncludeItemTypes: "Movie,Series,Episode"
            Fields: "Overview,PrimaryImageAspectRatio,MediaSources"
            EnableImageTypes: "Primary,Backdrop"
            ImageTypeLimit: 1
            Limit: 60
        })
        if not result.ok then return ApiFailure(result)
        items = NormalizeItems(session, FieldOr(result.data, "Items", invalid))
    end if

    return Success(items)
end function

function LoadDetails(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    itemId = StringOr(FieldOr(payload, "itemId", ""))
    if session = invalid or itemId = "" then return Failure("The selected media item is invalid.")

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/library/metadata/" + UrlEscape(itemId), {
            includeExtras: 1
            includeChapters: 1
        })
        if not result.ok then return ApiFailure(result)
        rawItems = ArrayOr(FieldOr(PlexContainer(result.data), "Metadata", invalid))
        if rawItems.Count() = 0 then return Failure("This item is no longer available.")
        item = PlexItem(session, rawItems[0])
    else
        result = JellyfinRequest(session, "/Users/" + UrlEscape(session.userId) + "/Items/" + UrlEscape(itemId), {
            Fields: "Overview,PrimaryImageAspectRatio,MediaSources,MediaStreams"
        })
        if not result.ok then return ApiFailure(result)
        item = JellyfinItem(session, result.data)
    end if

    return Success(item)
end function

function LoadChildren(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    item = FieldOr(payload, "item", invalid)
    if session = invalid or item = invalid then return Failure("The selected item cannot be browsed.")

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/library/metadata/" + UrlEscape(item.id) + "/children")
        if not result.ok then return ApiFailure(result)
        container = PlexContainer(result.data)
        values = FieldOr(container, "Metadata", FieldOr(container, "Directory", invalid))
    else
        if StringOr(item.type) = "show" then
            result = JellyfinRequest(session, "/Shows/" + UrlEscape(item.id) + "/Seasons", {
                UserId: session.userId
                Fields: "Overview,PrimaryImageAspectRatio"
            })
        else
            raw = FieldOr(item, "raw", {})
            seriesId = StringOr(FieldOr(raw, "SeriesId", item.id))
            result = JellyfinRequest(session, "/Shows/" + UrlEscape(seriesId) + "/Episodes", {
                UserId: session.userId
                SeasonId: item.id
                Fields: "Overview,PrimaryImageAspectRatio,MediaSources"
            })
        end if
        if not result.ok then return ApiFailure(result)
        values = FieldOr(result.data, "Items", invalid)
    end if

    return Success(NormalizeItems(session, values), item.title)
end function

function CreatePlayback(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    item = FieldOr(payload, "item", invalid)
    if session = invalid or item = invalid then return Failure("The selected item cannot be played.")
    if not BoolOr(FieldOr(item, "playable", false)) then return Failure("Choose a playable movie or episode.")

    detailsResult = LoadDetails({ session: session, itemId: item.id })
    if not detailsResult.ok then return detailsResult
    detail = detailsResult.data
    sessionId = NewSessionId()

    if LCase(StringOr(session.provider)) = "plex" then
        url = WithQuery(JoinUrl(session.baseUrl, "/video/:/transcode/universal/start.m3u8"), {
            path: "/library/metadata/" + detail.id
            mediaIndex: 0
            partIndex: 0
            protocol: "hls"
            fastSeek: 1
            directPlay: 1
            directStream: 1
            subtitleSize: 100
            audioBoost: 100
            location: "lan"
            offset: Int(NumberOr(detail.resumeMs) / 1000)
            session: sessionId
            "X-Plex-Client-Identifier": DeviceId()
            "X-Plex-Product": PlezyProduct()
            "X-Plex-Version": PlezyVersion()
            "X-Plex-Platform": "Roku"
            "X-Plex-Device": "Roku"
            "X-Plex-Token": session.token
        })
        directUrl = ""
        media = ArrayOr(FieldOr(detail.raw, "Media", invalid))
        if media.Count() > 0 then
            parts = ArrayOr(FieldOr(media[0], "Part", invalid))
            if parts.Count() > 0 then
                partKey = StringOr(FieldOr(parts[0], "key", ""))
                if partKey <> "" then directUrl = WithQuery(JoinUrl(session.baseUrl, partKey), { "X-Plex-Token": session.token })
            end if
        end if
        mediaSourceId = ""
    else
        mediaSources = ArrayOr(FieldOr(detail.raw, "MediaSources", invalid))
        mediaSourceId = ""
        if mediaSources.Count() > 0 then mediaSourceId = StringOr(FieldOr(mediaSources[0], "Id", ""))
        url = WithQuery(JoinUrl(session.baseUrl, "/Videos/" + UrlEscape(detail.id) + "/master.m3u8"), {
            UserId: session.userId
            DeviceId: DeviceId()
            MediaSourceId: mediaSourceId
            PlaySessionId: sessionId
            api_key: session.token
            VideoCodec: "h264"
            AudioCodec: "aac"
            TranscodingContainer: "ts"
            SegmentContainer: "ts"
            AllowVideoStreamCopy: "true"
            AllowAudioStreamCopy: "true"
            EnableAutoStreamCopy: "true"
            BreakOnNonKeyFrames: "false"
            StartTimeTicks: Int(NumberOr(detail.resumeMs)) * 10000&
        })
        directUrl = WithQuery(JoinUrl(session.baseUrl, "/Videos/" + UrlEscape(detail.id) + "/stream"), {
            static: "true"
            MediaSourceId: mediaSourceId
            api_key: session.token
        })
    end if

    return Success({
        provider: session.provider
        item: detail
        url: url
        directUrl: directUrl
        sessionId: sessionId
        mediaSourceId: mediaSourceId
        startMs: NumberOr(detail.resumeMs)
        durationMs: NumberOr(detail.durationMs)
        progressStarted: false
    })
end function

function ReportProgress(payload as Object) as Object
    session = FieldOr(payload, "session", invalid)
    playback = FieldOr(payload, "playback", invalid)
    if session = invalid or playback = invalid then return Success({})
    positionMs = NumberOr(FieldOr(payload, "positionMs", 0))
    state = StringOr(FieldOr(payload, "state", "playing"))

    if LCase(StringOr(session.provider)) = "plex" then
        result = PlexRequest(session, "/:/timeline", {
            ratingKey: playback.item.id
            key: "/library/metadata/" + playback.item.id
            state: state
            time: Int(positionMs)
            duration: Int(NumberOr(playback.durationMs))
            session: playback.sessionId
        })
    else
        endpoint = ""
        if state = "stopped" then
            endpoint = "/Stopped"
        else if BoolOr(FieldOr(playback, "progressStarted", false)) then
            endpoint = "/Progress"
        end if
        body = FormatJson({
            ItemId: playback.item.id
            MediaSourceId: playback.mediaSourceId
            PlaySessionId: playback.sessionId
            PositionTicks: Int(positionMs) * 10000&
            IsPaused: state = "paused"
            PlayMethod: "Transcode"
        })
        result = JellyfinRequest(session, "/Sessions/Playing" + endpoint, invalid, "POST", body)
    end if

    if not result.ok then return ApiFailure(result)
    return Success({})
end function
