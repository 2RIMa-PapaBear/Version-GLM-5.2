/**
 * @license geomag
 * (c) 2020 Jan Greis
 * licensed under MIT
 *
 * PATCH LOCAL 01/10/2026 (audit N13) : coefficients WMM2025 officiels NOAA
 * (WMM2025.COF du 13/11/2024, époque 2025.0, domaine public US Gov) en
 * remplacement des WMM2020 — le 2020 extrapolé surestimait la déclinaison
 * Est de ~+0,4° en France en 2026. Époque JD 2025.0 = 2460676. 4e paramètre
 * dateMs OPTIONNEL sur field() : tester à une date fixée (défaut : maintenant).
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = global || self, factory(global.geomag = {}));
}(this, (function (exports) { 'use strict';

    var gnmWmm2025 = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-29351.8, -1410.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-2556.6, 2951.1, 1649.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [1361, -2404.1, 1243.8, 453.6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [895, 799.5, 55.7, -281.1, 12.1, 0, 0, 0, 0, 0, 0, 0, 0],
        [-233.2, 368.9, 187.2, -138.7, -142, 20.9, 0, 0, 0, 0, 0, 0, 0],
        [64.4, 63.8, 76.9, -115.7, -40.9, 14.9, -60.7, 0, 0, 0, 0, 0, 0],
        [79.5, -77, -8.8, 59.3, 15.8, 2.5, -11.1, 14.2, 0, 0, 0, 0, 0],
        [23.2, 10.8, -17.5, 2, -21.7, 16.9, 15, -16.8, 0.9, 0, 0, 0, 0],
        [4.6, 7.8, 3, -0.2, -2.5, -13.1, 2.4, 8.6, -8.7, -12.9, 0, 0, 0],
        [-1.3, -6.4, 0.2, 2, -1, -0.6, -0.9, 1.5, 0.9, -2.7, -3.9, 0, 0],
        [2.9, -1.5, -2.5, 2.4, -0.6, -0.1, -0.6, -0.1, 1.1, -1, -0.2, 2.6, 0],
        [-2, -0.2, 0.3, 1.2, -1.3, 0.6, 0.6, 0.5, -0.1, -0.4, -0.2, -1.3, -0.7],
    ];
    var hnmWmm2025 = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 4545.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -3133.6, -815.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -56.6, 237.5, -549.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 278.6, -133.9, 212, -375.6, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 45.4, 220.2, -122.9, 43, 106.1, 0, 0, 0, 0, 0, 0, 0],
        [0, -18.4, 16.8, 48.8, -59.8, 10.9, 72.7, 0, 0, 0, 0, 0, 0],
        [0, -48.9, -14.4, -1, 23.4, -7.4, -25.1, -2.3, 0, 0, 0, 0, 0],
        [0, 7.1, -12.6, 11.4, -9.7, 12.7, 0.7, -5.2, 3.9, 0, 0, 0, 0],
        [0, -24.8, 12.2, 8.3, -3.3, -5.2, 7.2, -0.6, 0.8, 10, 0, 0, 0],
        [0, 3.3, 0, 2.4, 5.3, -9.1, 0.4, -4.2, -3.8, 0.9, -9.1, 0, 0],
        [0, 0, 2.9, -0.6, 0.2, 0.5, -0.3, -1.2, -1.7, -2.9, -1.8, -2.3, 0],
        [0, -1.3, 0.7, 1, -1.4, 0, 0.6, -0.1, 0.8, 0.1, -1, 0.1, 0.2],
    ];
    var gtnmWmm2025 = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [12, 9.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-11.6, -5.2, -8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-1.3, -4.2, 0.4, -15.6, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [-1.6, -2.4, -6, 5.6, -7, 0, 0, 0, 0, 0, 0, 0, 0],
        [0.6, 1.4, 0, 0.6, 2.2, 0.9, 0, 0, 0, 0, 0, 0, 0],
        [-0.2, -0.4, 0.9, 1.2, -0.9, 0.3, 0.9, 0, 0, 0, 0, 0, 0],
        [0, -0.1, -0.1, 0.5, -0.1, -0.8, -0.8, 0.8, 0, 0, 0, 0, 0],
        [-0.1, 0.2, 0, 0.5, -0.1, 0.3, 0.2, 0, 0.2, 0, 0, 0, 0],
        [0, -0.1, 0.1, 0.3, -0.3, 0, 0.3, -0.1, 0.1, -0.1, 0, 0, 0],
        [0.1, 0, 0.1, 0.1, 0, -0.3, 0, -0.1, -0.1, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, -0.1, 0, 0, -0.1, -0.1, -0.1, -0.1, 0],
        [0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, -0.1, 0, -0.1],
    ];
    var htnmWmm2025 = [
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -21.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -27.7, -12.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 4, -0.3, -4.1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -1.1, 4.1, 1.6, -4.4, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, -0.5, 2.2, 0.4, 1.7, 1.9, 0, 0, 0, 0, 0, 0, 0],
        [0, 0.3, -1.6, -0.4, 0.9, 0.7, 0.9, 0, 0, 0, 0, 0, 0],
        [0, 0.6, 0.5, -0.8, 0, -1, 0.6, -0.2, 0, 0, 0, 0, 0],
        [0, -0.2, 0.5, -0.4, 0.4, -0.5, -0.6, 0.3, 0.2, 0, 0, 0, 0],
        [0, -0.3, 0.3, -0.3, 0.3, 0.2, -0.1, -0.2, 0.4, 0.1, 0, 0, 0],
        [0, 0, 0, -0.2, 0.1, -0.1, 0.1, 0, -0.1, 0.2, 0, 0, 0],
        [0, 0, 0.1, 0, 0.1, 0, 0, 0.1, 0, 0, 0, 0, 0],
        [0, 0, 0, -0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, -0.1],
    ];
    var globe = {
        a: 6378.137,
        b: 6356.7523142,
        r0: 6371.2
    };

    var zeroArray2D = function (rows, columns) {
        return Array(rows).fill('').map(function (_) { return Array(columns).fill(0); });
    };
    var julianYearsSince2025 = function (dateMs) {
        return ((dateMs != null ? dateMs : Date.now()) / 86400000 + 2440587.5 - 2460676) / 365.25;
    };
    var round = function (num, decimalPlaces) {
        return Number(Math.round(Number(num + "e+" + decimalPlaces)) + "e-" + decimalPlaces);
    };
    var normalizeInclination = function (inclination) {
        if (inclination > 90) {
            return inclination - 180;
        }
        else if (inclination < -90) {
            return inclination + 180;
        }
        return inclination;
    };
    var deg2rad = function (deg) { return deg * 0.017453292519943295; };
    var rad2deg = function (rad) { return rad * 57.29577951308232; };

    var P = zeroArray2D(13, 13);
    var DP = zeroArray2D(13, 13);
    var gnm = zeroArray2D(13, 13);
    var hnm = zeroArray2D(13, 13);
    var sm = Array(13).fill(0);
    var cm = Array(13).fill(0);
    var root = Array(13).fill(0);
    var roots = zeroArray2D(13, 13).map(function (row) { return row.map(function (_) { return [0, 0]; }); });
    for (var n = 2; n <= 12; n++) {
        root[n] = Math.sqrt((2.0 * n - 1) / (2.0 * n));
    }
    for (var m = 0; m <= 12; m++) {
        var mm = m * m;
        for (var n = Math.max(m + 1, 2); n <= 12; n++) {
            roots[m][n][0] = Math.sqrt((n - 1) * (n - 1) - mm);
            roots[m][n][1] = 1.0 / Math.sqrt(n * n - mm);
        }
    }
    var field = function (latitude, longitude, altitude, dateMs) {
        if (altitude === void 0) { altitude = 0; }
        var cosLat = Math.cos(deg2rad(latitude));
        var sinLat = Math.sin(deg2rad(latitude));
        var sr = Math.sqrt(Math.pow(globe.a, 2) * Math.pow(cosLat, 2) + Math.pow(globe.b, 2) * Math.pow(sinLat, 2));
        var theta = Math.atan2(cosLat * (altitude * sr + Math.pow(globe.a, 2)), sinLat * (altitude * sr + Math.pow(globe.b, 2)));
        var r = Math.sqrt(Math.pow(altitude, 2) +
            2 * altitude * sr +
            (Math.pow(globe.a, 4) - (Math.pow(globe.a, 4) - Math.pow(globe.b, 4)) * Math.pow(sinLat, 2)) /
                (Math.pow(globe.a, 2) - (Math.pow(globe.a, 2) - Math.pow(globe.b, 2)) * Math.pow(sinLat, 2)));
        var c = Math.cos(theta);
        var s = Math.sin(theta);
        var invS = 1 / (s + (s === 0 ? 1e-8 : 0));
        P[0][0] = 1;
        P[1][1] = s;
        P[1][0] = c;
        DP[1][0] = -s;
        DP[1][1] = c;
        for (var n = 2; n <= 12; n++) {
            P[n][n] = P[n - 1][n - 1] * s * root[n];
            DP[n][n] = (DP[n - 1][n - 1] * s + P[n - 1][n - 1] * c) * root[n];
        }
        for (var m = 0; m <= 12; m++) {
            for (var n = Math.max(m + 1, 2); n <= 12; n++) {
                P[n][m] = (P[n - 1][m] * c * (2 * n - 1) - P[n - 2][m] * roots[m][n][0]) * roots[m][n][1];
                DP[n][m] = ((DP[n - 1][m] * c - P[n - 1][m] * s) * (2 * n - 1) - DP[n - 2][m] * roots[m][n][0]) *
                    roots[m][n][1];
            }
        }
        var julianYears = julianYearsSince2025(dateMs);
        for (var n = 1; n <= 12; n++) {
            for (var m = 0; m <= 12; m++) {
                gnm[n][m] = gnmWmm2025[n][m] + julianYears * gtnmWmm2025[n][m];
                hnm[n][m] = hnmWmm2025[n][m] + julianYears * htnmWmm2025[n][m];
            }
        }
        for (var m = 0; m <= 12; m++) {
            sm[m] = Math.sin(m * deg2rad(longitude));
            cm[m] = Math.cos(m * deg2rad(longitude));
        }
        var BR = 0.0;
        var BTheta = 0.0;
        var BPhi = 0.0;
        var fn0 = globe.r0 / r;
        var fn = Math.pow(fn0, 2);
        for (var n = 1; n <= 12; n++) {
            var c1n = 0;
            var c2n = 0;
            var c3n = 0;
            for (var m = 0; m <= n; m++) {
                var tmp = gnm[n][m] * cm[m] + hnm[n][m] * sm[m];
                c1n += tmp * P[n][m];
                c2n += tmp * DP[n][m];
                c3n += m * (gnm[n][m] * sm[m] - hnm[n][m] * cm[m]) * P[n][m];
            }
            fn *= fn0;
            BR += (n + 1) * c1n * fn;
            BTheta -= c2n * fn;
            BPhi += c3n * fn * invS;
        }
        var psi = theta - (Math.PI / 2 - deg2rad(latitude));
        var sinPsi = Math.sin(psi);
        var cosPsi = Math.cos(psi);
        var X = -BTheta * cosPsi - BR * sinPsi;
        var Y = BPhi;
        var Z = BTheta * sinPsi - BR * cosPsi;
        var declination = X !== 0 || Y !== 0 ? round(rad2deg(Math.atan2(Y, X)), 2) : 0;
        var inclination = Y !== 0 || (X !== 0 && Z !== 0)
            ? normalizeInclination(rad2deg(Math.atan2(Z * Math.sin(Math.atan2(Y, X)), Y)))
            : 0;
        return {
            declination: round(declination, 2),
            inclination: round(inclination, 2),
            intensity: Math.round(Math.sqrt(Math.pow(X, 2) + Math.pow(Y, 2) + Math.pow(Z, 2))),
            northIntensity: Math.round(X),
            eastIntensity: Math.round(Y),
            verticalIntensity: Math.round(Z),
            horizontalIntensity: Math.round(Math.sqrt(Math.pow(X, 2) + Math.pow(Y, 2)))
        };
    };

    exports.field = field;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
