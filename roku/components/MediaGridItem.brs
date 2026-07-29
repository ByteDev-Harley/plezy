sub init()
    m.poster = m.top.FindNode("poster")
    m.title = m.top.FindNode("title")
    m.focusFrame = m.top.FindNode("focusFrame")
    m.progressTrack = m.top.FindNode("progressTrack")
    m.progressFill = m.top.FindNode("progressFill")
end sub

sub showContent()
    content = m.top.itemContent
    if content = invalid then return

    m.poster.uri = content.HDPosterUrl
    m.title.text = content.title

    progress = content.BookmarkPosition
    duration = content.Length
    if duration > 0 and progress > 0 then
        width = Int(230 * progress / duration)
        if width < 4 then width = 4
        if width > 230 then width = 230
        m.progressFill.width = width
        m.progressTrack.visible = true
        m.progressFill.visible = true
    else
        m.progressTrack.visible = false
        m.progressFill.visible = false
    end if
end sub

sub showFocus()
    percent = m.top.focusPercent
    m.focusFrame.opacity = 0.15 + (0.85 * percent)
    scale = 1.0 + (0.035 * percent)
    m.top.scale = [scale, scale]
end sub

