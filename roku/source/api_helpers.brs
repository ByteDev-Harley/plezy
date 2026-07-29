' Shared helpers for ApiTask. Network and registry operations intentionally run
' on a Task thread, never on the SceneGraph render thread.

function PlezyProduct() as String
    return "Plezy Roku"
end function

function PlezyVersion() as String
    return "2.10.0-roku.2"
end function

function DeviceId() as String
    info = CreateObject("roDeviceInfo")
    id = info.GetChannelClientId()
    if id = invalid or id = "" then id = info.GetDeviceUniqueId()
    return id
end function

function ValueOr(value as Dynamic, fallback as Dynamic) as Dynamic
    if value = invalid then return fallback
    return value
end function

function StringOr(value as Dynamic, fallback = "" as String) as String
    if value = invalid then return fallback
    valueType = Type(value)
    if valueType = "String" or valueType = "roString" then return value
    return value.ToStr()
end function

function NumberOr(value as Dynamic, fallback = 0 as Dynamic) as Dynamic
    if value = invalid then return fallback
    valueType = Type(value)
    if valueType = "Integer" or valueType = "roInt" or valueType = "LongInteger" or valueType = "roLongInteger" or valueType = "Float" or valueType = "roFloat" or valueType = "Double" or valueType = "roDouble" then
        return value
    end if
    if Type(value) = "String" or Type(value) = "roString" then return Val(value)
    return fallback
end function

function BoolOr(value as Dynamic, fallback = false as Boolean) as Boolean
    if value = invalid then return fallback
    if Type(value) = "Boolean" or Type(value) = "roBoolean" then return value
    text = LCase(StringOr(value))
    return text = "true" or text = "1"
end function

function ArrayOr(value as Dynamic) as Object
    if value = invalid then return []
    valueType = Type(value)
    if valueType = "roArray" or valueType = "Array" then return value
    return [value]
end function

function FieldOr(value as Dynamic, key as String, fallback as Dynamic) as Dynamic
    if value = invalid then return fallback
    valueType = Type(value)
    if valueType <> "roAssociativeArray" and valueType <> "AssociativeArray" then return fallback
    if value.DoesExist(key) then return value[key]
    return fallback
end function

function TrimSlash(value as Dynamic) as String
    text = StringOr(value).Trim()
    while text.Len() > 0 and text.Right(1) = "/"
        text = text.Left(text.Len() - 1)
    end while
    return text
end function

function JoinUrl(baseUrl as Dynamic, path as Dynamic) as String
    base = TrimSlash(baseUrl)
    suffix = StringOr(path)
    while suffix.Len() > 0 and suffix.Left(1) = "/"
        suffix = suffix.Mid(1)
    end while
    return base + "/" + suffix
end function

function UrlEscape(value as Dynamic) as String
    transfer = CreateObject("roUrlTransfer")
    return transfer.Escape(StringOr(value))
end function

function QueryString(values as Dynamic) as String
    if values = invalid then return ""
    parts = []
    for each key in values
        value = values[key]
        if value <> invalid and StringOr(value) <> "" then
            parts.Push(UrlEscape(key) + "=" + UrlEscape(value))
        end if
    end for
    return parts.Join("&")
end function

function WithQuery(url as String, values as Dynamic) as String
    query = QueryString(values)
    if query = "" then return url
    separator = "?"
    if Instr(1, url, "?") > 0 then separator = "&"
    return url + separator + query
end function

function HttpRequest(url as String, method = "GET" as String, headers = invalid as Dynamic, body = "" as String) as Object
    port = CreateObject("roMessagePort")
    transfer = CreateObject("roUrlTransfer")
    transfer.SetMessagePort(port)
    transfer.SetUrl(url)
    transfer.RetainBodyOnError(true)
    transfer.EnableEncodings(true)
    transfer.SetMinimumTransferRate(1, 20)

    if LCase(url.Left(8)) = "https://" then
        transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
        transfer.InitClientCertificates()
    end if

    if headers <> invalid then
        for each name in headers
            transfer.AddHeader(name, StringOr(headers[name]))
        end for
    end if

    upperMethod = UCase(method)
    started = false
    if upperMethod = "GET" then
        started = transfer.AsyncGetToString()
    else
        if upperMethod <> "POST" then transfer.SetRequest(upperMethod)
        started = transfer.AsyncPostFromString(body)
    end if

    if not started then
        return {
            ok: false
            code: 0
            body: ""
            message: "The network request could not be started."
        }
    end if

    event = Wait(25000, port)
    if event = invalid then
        transfer.AsyncCancel()
        return {
            ok: false
            code: 0
            body: ""
            message: "The server did not respond within 25 seconds."
        }
    end if

    if Type(event) <> "roUrlEvent" then
        return {
            ok: false
            code: 0
            body: ""
            message: "Roku returned an unexpected network event."
        }
    end if

    code = event.GetResponseCode()
    responseBody = event.GetString()
    ok = code >= 200 and code < 300
    message = event.GetFailureReason()
    if not ok and message = "" then message = "Request failed with HTTP " + code.ToStr() + "."

    return {
        ok: ok
        code: code
        body: responseBody
        message: message
    }
end function

function JsonRequest(url as String, method = "GET" as String, headers = invalid as Dynamic, body = "" as String) as Object
    result = HttpRequest(url, method, headers, body)
    if not result.ok then
        payload = invalid
        if result.body <> "" then payload = ParseJson(result.body)
        detail = ""
        if payload <> invalid then
            detail = StringOr(FieldOr(payload, "Message", FieldOr(payload, "message", FieldOr(payload, "error", ""))))
        end if
        if detail <> "" then result.message = detail
        return result
    end if

    if result.body = "" then
        result.data = {}
        return result
    end if

    data = ParseJson(result.body)
    if data = invalid then
        return {
            ok: false
            code: result.code
            body: result.body
            message: "The server returned malformed JSON."
        }
    end if

    result.data = data
    return result
end function

function Success(data as Dynamic, label = "" as String) as Object
    return {
        ok: true
        data: data
        label: label
    }
end function

function Failure(message as String, code = 0 as Integer) as Object
    return {
        ok: false
        error: message
        code: code
    }
end function

function ApiFailure(result as Object) as Object
    return Failure(StringOr(FieldOr(result, "message", "The server request failed.")), Int(NumberOr(FieldOr(result, "code", 0))))
end function

function PlexHeaders(token = "" as String) as Object
    headers = {
        "Accept": "application/json"
        "X-Plex-Product": PlezyProduct()
        "X-Plex-Version": PlezyVersion()
        "X-Plex-Client-Identifier": DeviceId()
        "X-Plex-Platform": "Roku"
        "X-Plex-Platform-Version": "10+"
        "X-Plex-Device": "Roku"
        "X-Plex-Device-Name": "Plezy Roku"
    }
    if token <> "" then headers["X-Plex-Token"] = token
    return headers
end function

function JellyfinHeaders(session as Dynamic, json = false as Boolean) as Object
    auth = "MediaBrowser Client=""" + PlezyProduct() + """, Device=""Roku"", DeviceId=""" + DeviceId() + """, Version=""" + PlezyVersion() + """"
    token = StringOr(FieldOr(session, "token", ""))
    if token <> "" then auth = auth + ", Token=""" + token + """"

    headers = {
        "Accept": "application/json"
        "Authorization": auth
    }
    if token <> "" then headers["X-Emby-Token"] = token
    if json then headers["Content-Type"] = "application/json"
    return headers
end function

function PlexRequest(session as Object, path as String, query = invalid as Dynamic, method = "GET" as String, body = "" as String) as Object
    url = WithQuery(JoinUrl(session.baseUrl, path), query)
    return JsonRequest(url, method, PlexHeaders(StringOr(session.token)), body)
end function

function JellyfinRequest(session as Object, path as String, query = invalid as Dynamic, method = "GET" as String, body = "" as String) as Object
    url = WithQuery(JoinUrl(session.baseUrl, path), query)
    return JsonRequest(url, method, JellyfinHeaders(session, body <> ""), body)
end function

function PlexImageUrl(session as Object, path as Dynamic, width = 420 as Integer, height = 630 as Integer) as String
    imagePath = StringOr(path)
    if imagePath = "" then return ""
    if LCase(imagePath.Left(7)) = "http://" or LCase(imagePath.Left(8)) = "https://" then return imagePath
    return WithQuery(JoinUrl(session.baseUrl, "/photo/:/transcode"), {
        width: width
        height: height
        minSize: 1
        upscale: 1
        url: imagePath
        "X-Plex-Token": session.token
    })
end function

function JellyfinImageUrl(session as Object, itemId as Dynamic, kind = "Primary" as String, width = 500 as Integer) as String
    id = StringOr(itemId)
    if id = "" then return ""
    return WithQuery(JoinUrl(session.baseUrl, "/Items/" + UrlEscape(id) + "/Images/" + kind), {
        maxWidth: width
        quality: 86
        api_key: session.token
    })
end function

function PlexContainer(payload as Dynamic) as Object
    container = FieldOr(payload, "MediaContainer", invalid)
    if container = invalid then return {}
    return container
end function

function PlexItem(session as Object, raw as Dynamic) as Object
    viewOffset = NumberOr(FieldOr(raw, "viewOffset", 0))
    duration = NumberOr(FieldOr(raw, "duration", 0))
    itemType = LCase(StringOr(FieldOr(raw, "type", "video")))
    title = StringOr(FieldOr(raw, "title", FieldOr(raw, "grandparentTitle", "Untitled")))
    parentTitle = StringOr(FieldOr(raw, "grandparentTitle", ""))
    subtitle = ""
    if parentTitle <> "" then
        subtitle = parentTitle
        seasonTitle = StringOr(FieldOr(raw, "parentTitle", ""))
        if seasonTitle <> "" then subtitle = subtitle + " - " + seasonTitle
        episodeNumber = NumberOr(FieldOr(raw, "index", 0))
        if episodeNumber > 0 then subtitle = subtitle + " - Episode " + episodeNumber.ToStr()
    else
        subtitle = StringOr(FieldOr(raw, "parentTitle", FieldOr(raw, "originalTitle", "")))
        if subtitle = "" and FieldOr(raw, "year", invalid) <> invalid then subtitle = StringOr(raw.year)
    end if

    id = StringOr(FieldOr(raw, "ratingKey", FieldOr(raw, "key", "")))
    key = StringOr(FieldOr(raw, "key", ""))
    if key = "" and id <> "" then key = "/library/metadata/" + id

    playable = itemType = "movie" or itemType = "episode" or itemType = "clip" or itemType = "track"
    hasChildren = itemType = "show" or itemType = "season" or itemType = "artist" or itemType = "album"

    return {
        id: id
        key: key
        title: title
        subtitle: subtitle
        summary: StringOr(FieldOr(raw, "summary", ""))
        type: itemType
        year: NumberOr(FieldOr(raw, "year", 0))
        thumb: PlexImageUrl(session, FieldOr(raw, "thumb", FieldOr(raw, "parentThumb", FieldOr(raw, "grandparentThumb", ""))), 420, 630)
        art: PlexImageUrl(session, FieldOr(raw, "art", FieldOr(raw, "grandparentArt", FieldOr(raw, "thumb", ""))), 1280, 720)
        durationMs: duration
        resumeMs: viewOffset
        playable: playable
        hasChildren: hasChildren
        raw: raw
    }
end function

function JellyfinItem(session as Object, raw as Dynamic) as Object
    sourceType = StringOr(FieldOr(raw, "Type", "Video"))
    typeMap = {
        Movie: "movie"
        Episode: "episode"
        Series: "show"
        Season: "season"
        Audio: "track"
        MusicAlbum: "album"
        MusicArtist: "artist"
        Video: "video"
    }
    itemType = LCase(sourceType)
    if typeMap.DoesExist(sourceType) then itemType = typeMap[sourceType]

    userData = FieldOr(raw, "UserData", {})
    durationMs = NumberOr(FieldOr(raw, "RunTimeTicks", 0)) / 10000.0
    resumeMs = NumberOr(FieldOr(userData, "PlaybackPositionTicks", 0)) / 10000.0
    parentTitle = StringOr(FieldOr(raw, "SeriesName", FieldOr(raw, "Album", "")))
    subtitle = parentTitle
    episodeNumber = NumberOr(FieldOr(raw, "IndexNumber", 0))
    if episodeNumber > 0 then
        if subtitle <> "" then subtitle = subtitle + " - "
        subtitle = subtitle + "Episode " + episodeNumber.ToStr()
    end if
    if subtitle = "" and FieldOr(raw, "ProductionYear", invalid) <> invalid then subtitle = StringOr(raw.ProductionYear)

    id = StringOr(FieldOr(raw, "Id", ""))
    backdropTags = ArrayOr(FieldOr(raw, "BackdropImageTags", invalid))
    artKind = "Primary"
    if backdropTags.Count() > 0 then artKind = "Backdrop/0"

    playable = itemType = "movie" or itemType = "episode" or itemType = "video" or itemType = "track"
    hasChildren = itemType = "show" or itemType = "season" or itemType = "artist" or itemType = "album"

    return {
        id: id
        key: id
        title: StringOr(FieldOr(raw, "Name", "Untitled"))
        subtitle: subtitle
        summary: StringOr(FieldOr(raw, "Overview", ""))
        type: itemType
        year: NumberOr(FieldOr(raw, "ProductionYear", 0))
        thumb: JellyfinImageUrl(session, id, "Primary", 420)
        art: JellyfinImageUrl(session, id, artKind, 1280)
        durationMs: durationMs
        resumeMs: resumeMs
        playable: playable
        hasChildren: hasChildren
        raw: raw
    }
end function

function NormalizeItems(session as Object, values as Dynamic) as Object
    items = []
    for each raw in ArrayOr(values)
        if LCase(StringOr(session.provider)) = "plex" then
            items.Push(PlexItem(session, raw))
        else
            items.Push(JellyfinItem(session, raw))
        end if
    end for
    return items
end function

function NewSessionId() as String
    info = CreateObject("roDeviceInfo")
    now = CreateObject("roDateTime")
    random = Rnd(2147483646)
    return info.GetChannelClientId() + "-" + now.AsSeconds().ToStr() + "-" + random.ToStr()
end function
