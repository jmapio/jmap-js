// -------------------------------------------------------------------------- \\
// File: DateJSON.js                                                          \\
// Module: API                                                                \\
// Author: Neil Jenkins                                                       \\
// License: © 2010-2015 FastMail Pty Ltd. MIT Licensed.                       \\
// -------------------------------------------------------------------------- \\

"use strict";

Date.prototype.toJSON = function () {
    var year = this.getUTCFullYear(),
        month = this.getUTCMonth() + 1,
        date = this.getUTCDate(),
        hour = this.getUTCHours(),
        minute = this.getUTCMinutes(),
        second = this.getUTCSeconds();
    return (
        ( year < 1000 ?
            '0' + ( year < 100 ? '0' + ( year < 10 ? '0' : '' ) : '' ) + year :
            '' + year ) + '-' +
        ( month < 10 ? '0' + month : '' + month ) + '-' +
        ( date < 10 ? '0' + date : '' + date ) + 'T' +
        ( hour < 10 ? '0' + hour : '' + hour ) + ':' +
        ( minute < 10 ? '0' + minute : '' + minute ) + ':' +
        ( second < 10 ? '0' + second : '' + second )
    );
};

Date.toUTCJSON = function ( date ) {
    return date.toJSON() + 'Z';
};
