const CONFIG = {
    colors: ["7eef6d", "ffe65d", "4d52e3", "861fde", "dc1f1f",
        "1fdbde", "ff2b75", "2bffa3", "555555"],
};

cv.onRuntimeInitialized = () => {
    console.log("Opencv.js start");

    let canvas = document.getElementById('canvas');
    let ctx = canvas.getContext('2d');

    let src = cv.imread('canvas');
    let dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);
    let lines = new cv.Mat();
    let color = new cv.Scalar(255, 0, 0);
    cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
    cv.Canny(src, src, 50, 200, 3);
    // You can try more different parameters
    cv.HoughLinesP(src, lines, 1, Math.PI / 180, 2, 0, 1);
    // draw lines
    for (let i = 0; i < lines.rows; ++i) {
        let startPoint = new cv.Point(lines.data32S[i * 4], lines.data32S[i * 4 + 1]);
        let endPoint = new cv.Point(lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3]);
        cv.line(dst, startPoint, endPoint, color);
    }
    cv.imshow('canvas', dst);
    src.delete(); dst.delete(); lines.delete();

    console.log("Opencv.js done")
};