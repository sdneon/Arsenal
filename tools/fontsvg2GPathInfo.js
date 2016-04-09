/**
 * Takes a SVG file generated from font (using Batik Font Converter)
 * and converts it to GPathInfo.
 *
 * @author DS
 **/

//JSLint static code analysis options
/*jslint node:true, ass:true, bitwise:true, sloppy:true, plusplus:true, continue:true, indent:4, stupid:true, white:true */

//Options
var FILE_FONTSVG = './fromfont.svg',
    //Specify this flag to round all numbers in path to integers during path conversion:
    ROUNDOFF = false,
    //Specify this flag to round all numbers in path to integers during resize operation:
    ROUNDOFF_ON_SIZE = true,
    //Specify this flag to resize to this maximum number of pixels in height:
    SCALE_TO_MAX_HEIGHT = 135,
    //Specify this flag to flip vertically:
    FLIP_VERTICAL = true,
    //maximum number of points to interpolate curve (10 is perfect, 5 is coarse)
    MAX_LEN = 10,
    //MAX_LEN = 10000,

    //Specify this flag to use the path converted fully to straight line segments:
    CONVERT_CURVE = true,
    //Specify this flag to use the converted curve without 'S' & 'T's (as they're converted to 'C' & 'Q's:
    CONVERT_CURVE_LESS = false,
    //
    // For debugging
    //
    PRINTSCREEN = false,
    DRAW_ORIGINAL = false,
    DRAW_STRAIGHTENED = true,
    DRAW_SPLITS = true,
    DRAW_REF_PTS = false;

//Constants
var RX_FONT_ENTRY = /<\s*glyph\s+unicode\s*=\s*"(\d)".*\s+d\s*=\s*\"([^"]+)"\s*\/>/gm,
    //RX_SVG_CMD = /([a-z])([^a-z]+)/gi;
    RX_SVG_CMD = /(?:([a-y])([^a-z]+))|(z)/gim,
    RX_LAST_COORD = /(-?\d+(?:\.\d*)?)[, \n](-?\d+(?:\.\d*)?)$/m,
    //RX_LAST_COORD = /(-?\d+(?:\.\d*)?(?:e-?\d+(?:\.\d*))?)[, \n](-?\d+(?:\.\d*)?(?:e-?\d+(?:\.\d*))?)$/m,
    RX_LAST_2ND_COORD = /(-?\d+(?:\.\d*)?)[, \n](-?\d+(?:\.\d*)?)[, \n](?:-?\d+(?:\.\d*)?)[, \n](?:-?\d+(?:\.\d*)?)$/m,
    //RX_COORD_AND_CHAR = /(-?\d+(?:\.\d*)?)([, \nA-Za-z]+)/gm,
    RX_2COORDS_AND_CHAR = /(-?\d+(?:\.\d*)?)[, \n](-?\d+(?:\.\d*)?)([, \nA-Za-z]+)/gm,
    MAP_PARENT_CMD = {
        s: 'C',
        S: 'C',
        t: 'Q',
        T: 'Q'
    },
    CANVAS_WIDTH = 10000;

var fs = require('fs'),
    http = require('http'),
    raphael = require('node-raphael');

var subpaths = {}, //straight lines only
    splits = {},
    svg;

/**
 * @param dp (int) number of desired decimal points to round to
 **/
function reducePrecision(val, dp)
{
    if (typeof val === 'string')
    {
        val = parseFloat(val);
    }
    var f = Math.pow(10, dp);
    return Math.round(val * f) / f;
}

/**
 * Reflect point (x, y) about (ox, oy).
 * @param ox (number) x coordinate of origin point to reflect given pt about.
 * @param oy (number) y coordinate of origin point to reflect given pt about.
 * @param x (number) x coordinate of point to be reflected about (ox, oy).
 * @param y (number) y coordinate of point to be reflected about (ox, oy).
 * @return (JSON) the reflected point as {x, y}.
 **/
function reflect(ox, oy, x, y)
{
    var dx = ox - x,
        dy = oy - y,
        lenSq = (dx * dx) + (dy * dy);

    if (lenSq <= 0)
    {
        return { x: x, y: y };
    }
    return { x: ox + dx, y: oy + dy };
}

/**
 * Resize given path to given maximum height.
 **/
function resize(rap, pathStr, maxHeight)
{
/*
    //Somehow, does NOT work, as path obtained is same as original.
    var element = rap.path(pathStr),
        bounds = element.getBBox(true), //true: without transform
        scale = maxHeight / bounds.height,
        scaledElement, newPath;

    scaledElement = element.scale(scale, scale);
    newPath = scaledElement.getSubpath(0, scaledElement.getTotalLength());
    element.remove();
    scaledElement.remove();
    return newPath;
*/
    var element = rap.path(pathStr),
        bounds = element.getBBox(true), //true: without transform
        scale = maxHeight / bounds.height,
        cy = (bounds.y + bounds.height) * scale / 2,
        newPath = 'M',
        match, x, y;

    element.remove();
    pathStr = pathStr.substring(1);
    while (match = RX_2COORDS_AND_CHAR.exec(pathStr))
    {
        x = parseFloat(match[1]) * scale;
        y = parseFloat(match[2]) * scale;
        if (FLIP_VERTICAL)
        {
            y = cy - (y - cy);
        }
        if (ROUNDOFF_ON_SIZE)
        {
//            x = x | 0;
//            y = y | 0;
            x = Math.round(x);
            y = Math.round(y);
        }
        newPath += x + ' ' + y + match[3];
    }
    return newPath;
}

/**
 * Resize given path to given maximum height (based on same univeral bounds).
 **/
function resize2(rap, pathStr, cy, scale)
{
    var element = rap.path(pathStr),
        newPath = 'M',
        match, x, y;

    cy *= scale;
    element.remove();
    pathStr = pathStr.substring(1);
    while (match = RX_2COORDS_AND_CHAR.exec(pathStr))
    {
        x = parseFloat(match[1]) * scale;
        y = parseFloat(match[2]) * scale;
        if (FLIP_VERTICAL)
        {
            y = cy - (y - cy);
        }
        if (ROUNDOFF_ON_SIZE)
        {
            x = x | 0;
            y = y | 0;
        }
        newPath += x + ' ' + y + match[3];
    }
    return newPath;
}

function extractNumbersFromFontSvg()
{
    var data = fs.readFileSync(FILE_FONTSVG, 'utf8'),
        outputNums = {},
        match, num, path;
    //data = data.replace(/\n+/g, ' ');
    while (match = RX_FONT_ENTRY.exec(data))
    {
        num = match[1];
        path = match[2];
        outputNums[num] = path;
    }
    return outputNums;
}

/**
 *
 **/
function splitVertical(rap, num, path)
{
    var top = {
            i: 0,
            x: 0,
            y: 99999999
        }, bottom = {
            i: 0,
            x: 0,
            y: -99999999
        },
        ptsParts = path.split(/[A-Z]/),
        //cmdsParts = path.split(/[^A-Z]+/), //should be M, Ls and Z only
        lastCoords = [],
        cnt = ptsParts.length - 1, i,
        val, lastCoordMatch,
        pathL, pathR;

    function getTranslateString()
    {
        return 't' + ((num%5+1)*205) + ' ' + (((num/5)|0)*205);
    }

    for (i = 1; i < cnt; ++i) //skip 1st and last empty non-coordinates
    {
        lastCoordMatch = ptsParts[i].match(RX_LAST_COORD);
        lastCoords[i] = {
            x: parseFloat(lastCoordMatch[1]),
            y: parseFloat(lastCoordMatch[2])
        };
        //console.log(num, i, cnt, ptsParts[i], lastCoordMatch);
        val = lastCoords[i].y;
        if (val < top.y)
        {
            top.i = i;
            top.x = lastCoords[i].x;
            top.y = val;
        }
        if (val > bottom.y)
        {
            bottom.i = i;
            bottom.x = lastCoords[i].x;
            bottom.y = val;
        }
    }
    //console.log('#', num, cnt, top, bottom);
    if (bottom.i > top.i)
    {
        pathL = 'M' + lastCoords[1].x + ' ' + lastCoords[1].y;
        for (i = 2; i <= top.i; ++i)
        {
            pathL += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        pathL += 'L' + top.x + ' -50L-50 -50L-50 150L' + bottom.x + ' 150';
//        rap.text(top.x, 0, '1');
//        rap.text(0, 0, '2');
//        rap.text(0, 150, '3');
//        rap.text(bottom.x, 150, '4');
//        rap.text(bottom.x, bottom.y, '5');
        for (i = bottom.i; i < cnt; ++i)
        {
            pathL += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        pathL += 'Z';

        pathR = 'M' + lastCoords[top.i].x + ' ' + lastCoords[top.i].y;
        for (i = top.i; i <= bottom.i; ++i)
        {
            pathR += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        pathR += 'L' + bottom.x + ' 150L150 150L150 -50L' + top.x + ' -50L' + top.x + ' ' + top.y + 'Z';
//        rap.text(bottom.x, 150, 'R1');
//        rap.text(150, 150, 'R2');
//        rap.text(150, 0, 'R3');
//        rap.text(top.x, 150, 'R4');
//        rap.text(top.x, top.y, 'R5');
    }
    else //bottom.i <= top.i
    {
        pathL = 'M' + lastCoords[bottom.i].x + ' ' + lastCoords[bottom.i].y;
        for (i = bottom.i; i <= top.i; ++i)
        {
            pathL += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        pathL += 'L' + top.x + ' -50L-50 -50L-50 150L' + bottom.x + ' 150L' + bottom.x + ' ' + bottom.y + 'Z';
//        rap.text(top.x, 0, '1');
//        rap.text(0, 0, '2');
//        rap.text(0, 150, '3');
//        rap.text(bottom.x, 150, '4');
//        rap.text(bottom.x, bottom.y, '5');

        pathR = 'M' + lastCoords[top.i].x + ' ' + lastCoords[top.i].y;
        for (i = top.i; i < cnt; ++i)
        {
            pathR += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        for (i = 1; i <= bottom.i; ++i)
        {
            pathR += 'L' + lastCoords[i].x + ' ' + lastCoords[i].y;
        }
        pathR += 'L' + bottom.x + ' 150L150 150L150 -50L' + top.x + ' -50L' + top.x + ' ' + top.y;
        pathR += 'Z';
    }
    //console.log(path);
    //console.log(pathL);
    if (DRAW_SPLITS)
    {
        rap.path(pathL)
            .transform(getTranslateString())
            .attr({stroke: '#F00', 'stoke-width': 10, fill: '#F00', 'fill-opacity': 0.5, title: 'L' + num});
        rap.path(pathR)
            .transform(getTranslateString())
            .attr({stroke: '#00F', 'stoke-width': 10, fill: '#00F', 'fill-opacity': 0.5, title: 'R' + num});
    }
    if (DRAW_REF_PTS)
    {
        rap.circle(top.x, top.y, 3)
            .transform(getTranslateString())
            .attr({fill: '#0F0'});
        rap.circle(bottom.x, bottom.y, 3)
            .transform(getTranslateString())
            .attr({fill: '#F00'});
        rap.circle(lastCoords[1].x, lastCoords[1].y, 3)
            .transform(getTranslateString())
            .attr({fill: '#00F'});
        rap.circle(lastCoords[cnt-1].x, lastCoords[cnt-1].y, 3)
            .transform(getTranslateString())
            .attr({stroke: '#F0F'});
    }
    //rap.setViewBox(-60, -60, 300, 300);
}

/**
 * Extracts individual paths in given object and
 * converts all non-L (straight line) SVG segments in each path to L commands.
 * (M, L and Z are not converted).
 **/
function processNumber(rap, num, path)
{
    path = path.replace(/\n/g, ' ');
    if (DRAW_ORIGINAL)
    {
        rap.path(path);
    }
    //console.log('>>>', num, '>>>', path);
    var paths = path.split(/m/i),
        subpathsRaw = [], //curves et al
        cnt = paths.length, i,
        subpath,
        cmds,
        lastCmd = false, lastCtrlPt,
        //last coordinate (which in SVG parlance is the current point):
        lastCoordMatch, lastX, lastY,
        curvePath, convertedCurvePath,
        realLen, len, j, pt, inc;

    if (PRINTSCREEN)
    {
        console.log('#', num, '#paths:', cnt - 1, ', path=', path, '===\n');
    }
    subpaths[num] = [];
    for (i = 1; //ignore first empty entry
        i < cnt; ++i)
    {
        subpathsRaw[i-1] = 'M' + paths[i]; //(M## ##L## ##Q## ##...)M## ...
        subpath = '';
        lastX = 0; lastY = 0;

        while (cmds = RX_SVG_CMD.exec(subpathsRaw[i-1])) //bracketed part: M## ##(L## ##)Q## ##...
        {
            if ((cmds[1] === 'l') || (cmds[1] === 'L')
                || (cmds[1] === 'm') || (cmds[1] === 'M'))
            {
                //retain straight line segment
                subpath += cmds[1].toUpperCase() + cmds[2];
                lastCoordMatch = cmds[2].match(RX_LAST_COORD);
                lastX = parseFloat(lastCoordMatch[1]);
                lastY = parseFloat(lastCoordMatch[2]);
                lastCmd = false;
            }
            else if ((cmds[1] === 'h') || (cmds[1] === 'H'))
            {
                subpath += 'L';
                lastX = parseFloat(cmds[2]);
                subpath += cmds[2];
                subpath += ' ' + lastY;
                lastCmd = false;
            }
            else if ((cmds[1] === 'v') || (cmds[1] === 'V'))
            {
                subpath += 'L';
                subpath += lastX;
                lastY = parseFloat(cmds[2]);
                subpath += ' ' + cmds[2];
                lastCmd = false;
            }
            else if ((cmds[3] === 'z') || (cmds[3] === 'Z'))
            {
                subpath += 'Z';
                lastY = lastX = 0;
                lastCmd = false;
            }
            else
            {
                //convert curve segment to series of straight line segments
                // by parsing points along curve
                if ( ((cmds[1] === 's') || (cmds[1] === 'S'))
                    || ((cmds[1] === 't') || (cmds[1] === 'T')) )
                {
                    //Need to get last control point if available
                    if (!lastCmd)
                    {
                        //Get current point (i.e. last point where pen stopped) to be the control point
                        convertedCurvePath = MAP_PARENT_CMD[cmds[1]]
                                + lastX + ' ' + lastY + ' ' + cmds[2] /*+ 'Z'*/;
                        curvePath = rap.path(
                            'M' + lastX + ' ' + lastY
                                + convertedCurvePath);

                        lastCtrlPt = {
                            x: lastX,
                            y: lastY
                        };
                    }
                    else
                    {
                        //Need to reflect last control point from previous cmd
                        // about the start point of this cmd (i.e. last point)
                        // to use as control point for this cmd
                        lastCtrlPt = reflect(
                            lastX, lastY,
                            lastCtrlPt.x, lastCtrlPt.y //last control point
                            );
                        convertedCurvePath = MAP_PARENT_CMD[cmds[1]]
                                + lastCtrlPt.x + ' ' + lastCtrlPt.y + ' ' + cmds[2] /*+ 'Z'*/;
                        curvePath = rap.path(
                            'M' + lastX + ' ' + lastY
                                + convertedCurvePath);
                    }
                    lastCmd = MAP_PARENT_CMD[cmds[1]];
                }
                else if ( ((cmds[1] === 'c') || (cmds[1] === 'C'))
                    || ((cmds[1] === 'q') || (cmds[1] === 'Q')) )
                {
                    convertedCurvePath = cmds[1] + cmds[2] /*+ 'Z'*/;
                    curvePath = rap.path(
                        'M' + lastX + ' ' + lastY + convertedCurvePath);
                    lastCoordMatch = cmds[2].match(RX_LAST_2ND_COORD);
                    lastCmd = cmds[1].toUpperCase();
                    lastCtrlPt = {
                        x: parseFloat(lastCoordMatch[1]),
                        y: parseFloat(lastCoordMatch[2])
                    };
                }
                else
                {
                    console.log('***', cmds[1], ' not supported!');
                    lastCmd = false;
                    convertedCurvePath = false;
                    continue;
                }
//                curvePath = rap.path(
//                    'M' + lastX + ' ' + lastY + cmds[1] + cmds[2] /*+ 'Z'*/);
                realLen = curvePath.getTotalLength();

                if (CONVERT_CURVE)
                {
                    /**
                     * Output curve is coarse.
                     * Maybe getPointAtLength is inaccurate OR
                     * need to handle reused control point in T-after-Q & S-after-C.
                     **/
                    len = realLen | 0;
                    //console.log('curve len=', len); //DEBUG
                    inc = 1;
                    if (len > MAX_LEN)
                    {
                        inc = len / MAX_LEN;
                    }
                    if (len > 0)
                    {
                        for (j = 0; j < len; j += inc)
                        {
                            pt = curvePath.getPointAtLength(j);
                            if (!ROUNDOFF)
                            {
//                                subpath += 'L' + pt.x + ' ' + pt.y;
                                subpath += 'L' + reducePrecision(pt.x, 3) + ' ' + reducePrecision(pt.y, 3);
                            }
                            else
                            {
                                subpath += 'L' + Math.round(pt.x) + ' ' + Math.round(pt.y);
                            }
                        }
                        //add last pt
                        pt = curvePath.getPointAtLength(len);
                        if (!ROUNDOFF)
                        {
                            subpath += 'L' + pt.x + ' ' + pt.y;
                        }
                        else
                        {
                            subpath += 'L' + Math.round(pt.x) + ' ' + Math.round(pt.y);
                        }
                    }
                }
                else //not converting curve
                {
                    if (CONVERT_CURVE_LESS && convertedCurvePath)
                    {
                        subpath += convertedCurvePath;
                    }
                    else
                    {
                        subpath += cmds[1].toUpperCase() + cmds[2];
                    }
                }
//                lastCoordMatch = cmds[2].match(RX_LAST_COORD);
//                lastX = parseFloat(lastCoordMatch[1]);
//                lastY = parseFloat(lastCoordMatch[2]);
                pt = curvePath.getPointAtLength(realLen);
                lastX = pt.x;
                lastY = pt.y;
                curvePath.remove();
            }
        }
        if (PRINTSCREEN)
        {
            console.log(num + '> path#' + i, subpath, '\n===\n');
        }
        //subpath += 'Z'; //close path //not needed as already closed
        subpaths[num].push(subpath);

        if ((SCALE_TO_MAX_HEIGHT === undefined) && DRAW_STRAIGHTENED)
        {
            rap.path(subpath);
        }
    }
}

function run()
{
    svg = raphael.generate(CANVAS_WIDTH, CANVAS_WIDTH, function (r) {
        var outputNums = extractNumbersFromFontSvg(),
            i, j,
            subpath, element,
            bounds, val,
            minX = 9999999999, minY = 9999999999,
            maxX = -9999999999, maxY = -9999999999,
            boundsMaxHeight = -9999999999,
            cy;

        //console.log(outputNums);
        for (i = 0; i < 10; ++i)
        //for (i = 0; i < 1; ++i) //DEBUG
        {
            processNumber(r, i, outputNums[i]);
        }

        for (i = 0; i < 10; ++i)
        {
            for (j = 0; j < subpaths[i].length; ++j)
            {
                subpath = subpaths[i][j];
                element = r.path(subpath);
                bounds = element.getBBox(true);
                element.remove();
                if (bounds.x < minX)
                {
                    minX = bounds.x;
                }
                if (bounds.y < minY)
                {
                    minY = bounds.y;
                }
                val = bounds.x + bounds.width;
                if (val > maxX)
                {
                    maxX = val;
                }
                val = bounds.y + bounds.height;
                if (val > maxY)
                {
                    maxY = val;
                }
                if (bounds.height > boundsMaxHeight)
                {
                    boundsMaxHeight = bounds.height;
                }
            }
        }

        function getTranslateString(num, s)
        {
            return 't' + (s*205) + ' ' + ((num+2)*205);
        }

        //cx = (minX + maxX) / 2;
        cy = (minY + maxY) / 2;
        //console.log(minX|0, maxX|0, minY|0, maxY|0, cx|0, cy|0, boundsMaxHeight|0);
        for (i = 0; i < 10; ++i)
        {
            for (j = 0; j < subpaths[i].length; ++j)
            {
                subpath = subpaths[i][j];
                if (SCALE_TO_MAX_HEIGHT)
                {
                    subpaths[i][j] = subpath = resize2(r, subpath, cy, SCALE_TO_MAX_HEIGHT / boundsMaxHeight);
                }
                if (DRAW_STRAIGHTENED)
                {
                    r.path(subpath)
                        .transform(getTranslateString(i, j));
                }
            }
        }

//        for (i = 0; i < 9; ++i)
//        {
//            //for (j = 0; j < subpaths[i].length; ++j)
//            for (j = 0; j < 1; ++j) //TRY 1 first
//            {
//                splitVertical(r, i, subpaths[i][j]);
//            }
//        }
        //NOT OK: 3, 5
        for (i = 0; i <= 9; ++i)
        {
            if ((i === 6) || (i === 9))
            {
                splitVertical(r, i, subpaths[i][1]);
            }
            else if (i === 8)
            {
                splitVertical(r, i, subpaths[i][1]);
            }
            else
            {
                splitVertical(r, i, subpaths[i][0]);
            }
        }
//        splitVertical(r, 0, subpaths[0][0]);

        //var p = r.path("M295.186,122.908c12.434,18.149,32.781,18.149,45.215,0l12.152-17.736c12.434-18.149,22.109-15.005,21.5,6.986l-0.596,21.49c-0.609,21.992,15.852,33.952,36.579,26.578l20.257-7.207c20.728-7.375,26.707,0.856,13.288,18.29l-13.113,17.037c-13.419,17.434-7.132,36.784,13.971,43.001l20.624,6.076c21.103,6.217,21.103,16.391,0,22.608l-20.624,6.076c-21.103,6.217-27.39,25.567-13.971,43.001l13.113,17.037c13.419,17.434,7.439,25.664-13.287,18.289l-20.259-7.207c-20.727-7.375-37.188,4.585-36.578,26.576l0.596,21.492c0.609,21.991-9.066,25.135-21.5,6.986L340.4,374.543c-12.434-18.148-32.781-18.148-45.215,0.001l-12.152,17.736c-12.434,18.149-22.109,15.006-21.5-6.985l0.595-21.492c0.609-21.991-15.851-33.951-36.578-26.576l-20.257,7.207c-20.727,7.375-26.707-0.855-13.288-18.29l13.112-17.035c13.419-17.435,7.132-36.785-13.972-43.002l-20.623-6.076c-21.104-6.217-21.104-16.391,0-22.608l20.623-6.076c21.104-6.217,27.391-25.568,13.972-43.002l-13.112-17.036c-13.419-17.434-7.439-25.664,13.288-18.29l20.256,7.207c20.728,7.374,37.188-4.585,36.579-26.577l-0.595-21.49c-0.609-21.992,9.066-25.136,21.5-6.986L295.186,122.908z").attr({stroke: "#666", opacity: '0.3', "stroke-width": '10'});
//        var logo = r.set(
//          r.rect(13, 13, 116, 116, 30).attr({stroke: "none", fill: "#fff", rotation: '45', opacity: '0.2'}),
//          r.path("M129.657,71.361c0,3.812-1.105,7.451-3.153,10.563c-1.229,1.677-2.509,3.143-3.829,4.408l-0.095,0.095c-6.217,5.912-13.24,7.588-19.2,7.588c-3.28,0-6.24-0.508-8.566-1.096C81.19,89.48,66.382,77.757,59.604,60.66c3.65,1.543,7.662,2.396,11.869,2.396c15.805,0,28.849-12.04,30.446-27.429l22.073,22.072C127.645,61.351,129.657,66.201,129.657,71.361zM18.953,85.018c-3.653-3.649-5.663-8.5-5.663-13.656c0-5.16,2.01-10.011,5.661-13.656l14.934-14.935c-3.896,13.269-5.569,27.23-4.674,40.614c0.322,4.812,0.987,9.427,1.942,13.831L18.953,85.018zM44.482,46.869c3.279,25.662,23.592,50.991,47.552,57.046c3.903,0.986,7.729,1.472,11.432,1.472c0.055,0,0.107-0.005,0.161-0.005l-18.501,18.503c-3.647,3.646-8.498,5.654-13.652,5.654c-3.591,0-7.021-0.993-10.01-2.815l0.007-0.01c-1.177-0.78-2.298-1.66-3.388-2.593c-0.084-0.082-0.176-0.153-0.26-0.236l-3.738-3.738c-7.688-8.825-12.521-21.957-13.561-37.517C39.736,70.853,41.149,58.578,44.482,46.869").attr({fill: "#f89938", stroke: "none", opacity: '0.5'}),
//          r.circle(71, 32, 19).attr({stroke: "none", fill: "#39f", opacity: '0.5'}));
//        logo.translate(245, 177);
        // logo end
    });
}

run();
//return;

/*jslint unparam:true*/
var server = http.createServer(function(req, res) {
    res.writeHead(200, {"Content-Type": "image/svg+xml"});
    res.end(svg);
});
/*jslint unparam:false*/

server.listen(parseInt(process.env.PORT, 10) || 3000);
console.log("server listening on port:", server.address().port);
