import QtQuick
import QtQuick.Shapes

Item {
    id: drawing
    implicitWidth: 480
    implicitHeight: 140
    required property bool moving
    required property bool leaving
    required property real release
    // Same clock as the window's iris: both lights arrive before it ends.
    readonly property real gather: smoothStep(release / 0.56)
    readonly property real filamentWidth: 1 - 0.97 * gather
    readonly property real flare: Math.pow(Math.sin(Math.PI * Math.min(1, release / 0.94)), 2)
    function smoothStep(value: real): real {
        const t = Math.min(1, Math.max(0, value))
        return t * t * (3 - 2 * t)
    }
    // The last streak of light goes out while the core of the real scene shows.
    opacity: 1 - smoothStep((release - 0.45) / 0.37)

    property real phase: 0.28
    readonly property string thread: "M20 75 C115 111 157 31 240 70 S364 39 456 36"

    NumberAnimation on phase {
        from: 0; to: 1; duration: 5400
        loops: Animation.Infinite
        running: drawing.moving
        paused: drawing.leaving
    }

    // Everything in one coordinate system. The center of the star is at (240,70).
    Shape {
        anchors.fill: parent
        preferredRendererType: Shape.CurveRenderer
        ShapePath {
            strokeColor: "transparent"
            fillGradient: RadialGradient {
                centerX: 240; centerY: 70; focalX: 240; focalY: 70; centerRadius: 61 + 20 * drawing.flare
                GradientStop { position: 0; color: "#8aedc394" }
                GradientStop { position: 0.10; color: "#48d79b75" }
                GradientStop { position: 0.36; color: "#197e5869" }
                GradientStop { position: 1; color: "#007e5869" }
            }
            PathSvg { path: "M175 5h130v130H175z" }
        }
        ShapePath {
            strokeColor: "transparent"
            fillGradient: LinearGradient {
                x1: 240 - 223 * drawing.filamentWidth; y1: 70 + 13 * drawing.filamentWidth
                x2: 240 + 219 * drawing.filamentWidth; y2: 70 - 17 * drawing.filamentWidth
                GradientStop { position: 0; color: "#006b668b" }
                GradientStop { position: 0.22; color: "#535f688d" }
                GradientStop { position: 0.50; color: "#beb49392" }
                GradientStop { position: 0.72; color: "#4ea58879" }
                GradientStop { position: 1; color: "#00977570" }
            }
            PathSvg { path: "M17 90 C119 97 152 23 240 70 C318 115 349 41 463 44 C354 36 323 125 240 71 C163 19 111 109 17 90Z" }
        }
        ShapePath {
            strokeColor: "transparent"
            fillGradient: LinearGradient {
                x1: 240 - 236 * drawing.filamentWidth; y1: 70
                x2: 240 + 230 * drawing.filamentWidth; y2: 70
                GradientStop { position: 0; color: "#00576986" }
                GradientStop { position: 0.31; color: "#695d678e" }
                GradientStop { position: 0.52; color: "#cdf5d8b6" }
                GradientStop { position: 0.75; color: "#967c6377" }
                GradientStop { position: 1; color: "#00645c74" }
            }
            PathSvg { path: "M4 82 C128 114 163 92 240 70 C309 50 369 34 470 58 C363 37 308 56 240 71 C158 100 116 114 4 82Z" }
        }
        ShapePath {
            fillColor: "transparent"; strokeWidth: 0.9
            strokeGradient: LinearGradient {
                x1: 240 - 220 * drawing.filamentWidth; y1: 70
                x2: 240 + 216 * drawing.filamentWidth; y2: 70
                GradientStop { position: 0; color: "#008d90aa" }
                GradientStop { position: 0.35; color: "#79898ca2" }
                GradientStop { position: 0.53; color: "#b4efcf9f" }
                GradientStop { position: 0.79; color: "#6fb99b8a" }
                GradientStop { position: 1; color: "#00b99b8a" }
            }
            PathSvg { path: drawing.thread }
        }
        ShapePath {
            fillColor: "transparent"; strokeWidth: 1.3
            strokeGradient: RadialGradient {
                centerX: spark.x; centerY: spark.y; focalX: centerX; focalY: centerY
                centerRadius: Math.max(0.01, 38 * Math.sin(Math.PI * spark.progress) * (1 - drawing.gather))
                GradientStop { position: 0; color: "#ddf7e0c5" }
                GradientStop { position: 0.42; color: "#58e9c6a3" }
                GradientStop { position: 1; color: "#00c9a7a4" }
            }
            PathSvg { path: drawing.thread }
        }
    }
    Shape {
        anchors.fill: parent
        preferredRendererType: Shape.CurveRenderer
        transform: Scale {
            origin.x: 240; origin.y: 70
            xScale: 1 + 1.05 * drawing.flare
            yScale: 1 - 0.22 * drawing.flare
        }
        ShapePath {
            fillColor: "#ffead0"; strokeColor: "transparent"
            PathSvg { path: "M240 49 C241 67 243 68 262 70 C243 71 241 74 240 91 C239 74 237 72 218 70 C237 68 239 66 240 49Z" }
        }
    }

    // Half of the way is exactly the center of the star at every window size.
    PathInterpolator {
        id: spark
        progress: drawing.phase + (0.5 - drawing.phase) * drawing.gather
        path: Path {
            startX: 20; startY: 75
            PathCubic { control1X: 115; control1Y: 111; control2X: 157; control2Y: 31; x: 240; y: 70 }
            PathPercent { value: 0.5 }
            PathCubic { control1X: 323; control1Y: 109; control2X: 364; control2Y: 39; x: 456; y: 36 }
            PathPercent { value: 1 }
        }
    }
    Rectangle {
        x: spark.x - width / 2; y: spark.y - height / 2
        width: 3.2; height: width; radius: width / 2
        color: "#eed9c4"
        opacity: 0.86 * Math.pow(Math.sin(Math.PI * spark.progress), 2)
    }
    PathInterpolator {
        id: incoming
        readonly property real start: drawing.phase < 0.5 ? 0.93 : 0.07
        path: spark.path
        progress: start + (0.5 - start) * drawing.gather
    }
    Rectangle {
        x: incoming.x - width / 2; y: incoming.y - height / 2
        width: 3.2; height: width; radius: width / 2
        color: "#eed9c4"
        opacity: drawing.smoothStep(drawing.release / 0.17) * (1 - drawing.gather)
    }
}
