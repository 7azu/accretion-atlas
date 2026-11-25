import QtQuick
import QtQuick.Shapes
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

ShellRoot {
    PanelWindow {
        id: panel
        readonly property var monitor: JSON.parse(Quickshell.env("ATLAS_MONITOR") || "{}")
        screen: Quickshell.screens.find(s => s.name === monitor.name) ?? Quickshell.screens[0]
        anchors { top: true; right: true; bottom: true; left: true }
        exclusiveZone: -1
        color: "transparent"
        mask: Region {}
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        WlrLayershell.namespace: "quickshell:app-color-fade"

        readonly property bool still: Quickshell.env("ATLAS_REDUCED_MOTION") === "false"
        readonly property var reserved: monitor.reserved ?? [0, 0, 0, 0]
        readonly property real gap: Number(Quickshell.env("ATLAS_GAP") || 16)
        property bool opening: false
        property bool guarded: false
        property bool launched: false
        property bool leaving: false
        property real entrance: 0
        property real release: 0
        // Background from pywal (the wallpaper's background color) when it is there, otherwise a dark blue.
        // Read at start (Component.onCompleted), before the first frame.
        property color base: "#101017"
        function baseA(alpha: real): color {
            return Qt.rgba(base.r, base.g, base.b, alpha)
        }
        FileView {
            id: walFile
            path: Quickshell.env("HOME") + "/.cache/wal/colors.json"
            blockLoading: true
        }
        // text() right at start (onLoaded would come after the first frame)
        Component.onCompleted: {
            try {
                const wal = JSON.parse(walFile.text())
                const bg = wal.special?.background || wal.colors?.color0
                if (bg) panel.base = bg
            } catch (error) {}
        }
        // Place of the black hole in the window (shares 0..1), reported by the plugin as "ready x y"
        property real anchorX: 0.5
        property real anchorY: 0.5

        function leave() {
            if (leaving) return
            leaving = true
            dissolve.start()
        }
        Connections {
            target: cover.Window.window
            function onFrameSwapped() {
                if (!panel.opening) {
                    panel.opening = true
                    enter.start()
                }
                if (panel.guarded && !panel.launched) {
                    panel.launched = true
                    Quickshell.execDetached([Quickshell.env("ATLAS_LAUNCH_SCRIPT"), "--open"])
                }
            }
        }
        FileView {
            path: Quickshell.env("ATLAS_START_DIR") + "/status"
            watchChanges: true
            onFileChanged: reload()
            onLoaded: {
                const message = text().trim()
                if (message.startsWith("ready")) {
                    const at = message.split(/\s+/).slice(1).map(Number)
                    if (at.length === 2 && at.every(v => isFinite(v) && v >= 0 && v <= 1)) {
                        panel.anchorX = at[0]
                        panel.anchorY = at[1]
                    }
                    panel.leave()
                } else if (message.startsWith("{")) {
                    // Also understand a plugin that still sends the earlier JSON signal.
                    try { if (JSON.parse(message).ready) panel.leave() } catch (error) {}
                }
            }
        }
        Timer { interval: 60000; running: true; onTriggered: panel.leave() }
        Timer {
            id: guardTimeout
            interval: 320
            onTriggered: {
                if (!panel.guarded) desktop.active = false
                panel.guarded = true
                cover.Window.window.update()
            }
        }

        Item {
            id: cover
            anchors.fill: parent

            // Take a still only after opening. It just keeps the desktop edges that are already
            // visible from the editor while Obsidian starts.
            Loader {
                id: desktop
                opacity: 0.995 * Math.max(0, 1 - panel.release * 10)
                anchors.fill: parent
                active: false
                sourceComponent: ScreencopyView {
                    captureSource: panel.screen
                    live: false
                    onHasContentChanged: if (hasContent) {
                        panel.guarded = true
                        cover.Window.window.update()
                    }
                }
            }
            Item {
                id: frame
                x: panel.reserved[0] + panel.gap
                y: panel.reserved[1] + panel.gap
                width: Math.max(1, cover.width - panel.reserved[0] - panel.reserved[2] - 2 * panel.gap)
                height: Math.max(1, cover.height - panel.reserved[1] - panel.reserved[3] - 2 * panel.gap)
                scale: panel.still ? 1 : 0.985 + 0.015 * panel.entrance
                layer.enabled: true
                layer.smooth: true
                // Without animations (reduced motion) fade out briefly, otherwise the iris opens.
                opacity: 0.996 * panel.entrance * (panel.still ? 1 - panel.release : 1)
                clip: true

                function smoothStep(value: real): real {
                    const t = Math.min(1, Math.max(0, value))
                    return t * t * (3 - 2 * t)
                }
                function smootherStep(value: real): real {
                    const t = Math.min(1, Math.max(0, value))
                    return t * t * t * (t * (t * 6 - 15) + 10)
                }
                // Iris: center = black hole. Clear inside, soft edge, fully open at the end.
                readonly property real irisX: width * panel.anchorX
                readonly property real irisY: height * panel.anchorY
                readonly property real corner: Math.hypot(Math.max(irisX, width - irisX), Math.max(irisY, height - irisY))
                readonly property real irisEnd: (corner + 30) / 0.65 + 10
                readonly property real open: panel.still ? 0 : smootherStep((panel.release - 0.08) / 0.86)
                readonly property real irisR: irisEnd * open
                readonly property real soft: 30 + 0.35 * irisR
                readonly property real reach: irisEnd + 0.4 * (30 + 0.35 * irisEnd)
                // Ring of light on the edge: comes with the opening, fades outwards
                readonly property real ring: panel.still ? 0 : Math.min(1, Math.sin(Math.PI * Math.min(1, panel.release * 1.1)) * (1 - panel.release) * 1.3)
                // Keep the stop positions strictly rising (Qt does not resolve equal positions clearly)
                function stop(radius: real, rank: int): real {
                    return Math.min(1 - (4 - rank) * 0.0005, Math.max(rank * 0.0005, radius / reach))
                }

                // A closed veil before the opening
                Rectangle {
                    anchors.fill: parent
                    color: panel.base
                    visible: frame.irisR <= 0
                }
                Shape {
                    anchors.fill: parent
                    visible: frame.irisR > 0
                    ShapePath {
                        strokeColor: "transparent"
                        fillGradient: RadialGradient {
                            centerX: frame.irisX; centerY: frame.irisY
                            focalX: frame.irisX; focalY: frame.irisY
                            centerRadius: frame.reach
                            GradientStop { position: frame.stop(frame.irisR - frame.soft, 0); color: panel.baseA(0) }
                            GradientStop { position: frame.stop(frame.irisR - frame.soft * 0.45, 1); color: panel.baseA(0x70 / 255) }
                            GradientStop { position: frame.stop(frame.irisR, 2); color: panel.base }
                            GradientStop { position: 1; color: panel.base }
                        }
                        PathSvg { path: `M0 0H${frame.width}V${frame.height}H0Z` }
                    }
                }
                Shape {
                    anchors.fill: parent
                    opacity: frame.ring
                    visible: opacity > 0.002 && frame.irisR > 0
                    ShapePath {
                        strokeColor: "transparent"
                        fillGradient: RadialGradient {
                            centerX: frame.irisX; centerY: frame.irisY
                            focalX: frame.irisX; focalY: frame.irisY
                            centerRadius: frame.reach
                            GradientStop { position: frame.stop(frame.irisR - frame.soft * 0.55, 0); color: "#00e0b48c" }
                            GradientStop { position: frame.stop(frame.irisR - frame.soft * 0.16, 1); color: "#26f2d6b8" }
                            GradientStop { position: frame.stop(frame.irisR - frame.soft * 0.04, 2); color: "#40fbeadb" }
                            GradientStop { position: frame.stop(frame.irisR + frame.soft * 0.06, 3); color: "#00fbeadb" }
                            GradientStop { position: 1; color: "#00fbeadb" }
                        }
                        PathSvg { path: `M0 0H${frame.width}V${frame.height}H0Z` }
                    }
                }
                // The star pulls in its threads of light and moves exactly onto the hole.
                readonly property real travel: smoothStep(panel.release / 0.34)
                Starlight {
                    id: starlight
                    x: frame.width / 2 + (frame.irisX - frame.width / 2) * frame.travel - width / 2
                    y: frame.height / 2 + (frame.irisY - frame.height / 2) * frame.travel - height / 2
                    width: implicitWidth; height: implicitHeight
                    scale: Math.min(1.3, frame.width * 0.64 / implicitWidth, Math.max(0.7, frame.height / 910))
                    moving: panel.opening && !panel.still
                    leaving: panel.leaving
                    release: panel.still ? 0 : Math.min(1, panel.release / 0.62)
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: parent.height / 2 + 55 * starlight.scale
                    opacity: 1 - frame.smoothStep(panel.release / 0.14)
                    text: "Loading the galaxy"
                    color: "#bfb9bb"
                    font.pixelSize: 13
                    font.letterSpacing: 0.8
                }
            }
        }
        NumberAnimation {
            id: enter
            target: panel; property: "entrance"; from: 0; to: 1
            duration: panel.still ? 100 : 430
            easing.type: Easing.InOutCubic
            onFinished: {
                desktop.active = true
                guardTimeout.start()
            }
        }
        NumberAnimation {
            id: dissolve
            target: panel; property: "release"; from: 0; to: 1
            duration: panel.still ? 150 : 1300
            easing.type: Easing.Linear
            onFinished: Qt.quit()
        }
    }
}
