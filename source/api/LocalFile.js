// -------------------------------------------------------------------------- \\
// File: LocalFile.js                                                         \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const Class = O.Class;
const Obj = O.Object;
const RunLoop = O.RunLoop;
const HttpRequest = O.HttpRequest;

const upload = JMAP.upload;
const auth = JMAP.auth;

// ---

const LocalFile = Class({

    Extends: Obj,

    nextEventTarget: upload,

    init: function ( file, accountId ) {
        this.file = file;
        this.accountId = accountId;
        this.blobId = '';

        // Using NFC form for the filename helps when it uses a combining
        // character that's not in our font. Firefox renders this badly, so
        // does Safari (but in a different way). By normalizing, the whole
        // replacement character will be drawn from the fallback font, which
        // looks much better. (Chrome does this by default anyway.)
        // See PTN425984
        var name = file.name;
        if ( name && name.normalize ) {
            name = name.normalize( 'NFC' );
        }
        this.name = name ||
            ( 'image.' + ( /\w+$/.exec( file.type ) || [ 'png' ] )[0] );
        this.type = file.type;
        this.size = file.size;

        this.isTooBig = false;
        this.isUploaded = false;

        this.response = null;
        this.progress = 0;
        this.loaded = 0;

        this._backoff = 500;

        LocalFile.parent.constructor.call( this );
    },

    destroy: function () {
        var request = this._request;
        if ( request ) {
            upload.abort( request );
        }
        LocalFile.parent.destroy.call( this );
    },

    upload: function ( obj, key ) {
        if ( obj && key ) {
            obj.removeObserverForKey( key, this, 'upload' );
        }
        if ( !this.isDestroyed ) {
            upload.send(
                this._request = new HttpRequest({
                    nextEventTarget: this,
                    method: 'POST',
                    url: auth.get( 'uploadUrl' ).replace(
                        '{accountId}', encodeURIComponent( this.accountId ) ),
                    headers: {
                        'Authorization': 'Bearer ' + auth.get( 'accessToken' ),
                    },
                    withCredentials: true,
                    responseType: 'json',
                    data: this.file,
                })
            );
        }
        return this;
    },

    _uploadDidProgress: function ( event ) {
        const loaded = event.loaded;
        const total = event.total;
        const delta = loaded - this.get( 'loaded' );
        const progress = ~~( 100 * loaded / total );
        this.set( 'progress', progress )
            .set( 'loaded', loaded )
            .fire( 'localfile:progress', {
                loaded: loaded,
                total: total,
                delta: delta,
                progress: progress,
            });
    }.on( 'io:uploadProgress' ),

    _uploadDidSucceed: function ( event ) {
        var response = event.data;

        // Was there an error?
        if ( !response ) {
            return this.onFailure( event );
        }

        this.beginPropertyChanges()
            .set( 'response', response )
            .set( 'blobId', response.blobId )
            .set( 'progress', 100 )
            .set( 'isUploaded', true )
            .endPropertyChanges()
            .uploadDidSucceed();
    }.on( 'io:success' ),

    _uploadDidFail: function ( event ) {
        this.set( 'progress', 0 );

        switch ( event.status ) {
        case 400: // Bad Request
        case 415: // Unsupported Media Type
            break;
        case 401: // Unauthorized
            auth.didLoseAuthentication()
                .addObserverForKey( 'isAuthenticated', this, 'upload' );
            break;
        case 404: // Not Found
            auth.fetchSessions()
                .addObserverForKey( 'uploadUrl', this, 'upload' );
            break;
        case 413: // Request Entity Too Large
            this.set( 'isTooBig', true );
            break;
        default:  // Connection failed or 503 Service Unavailable
            RunLoop.invokeAfterDelay( this.upload, this._backoff, this );
            this._backoff = Math.min( this._backoff * 2, 30000 );
            return;
        }

        this.uploadDidFail();
    }.on( 'io:failure' ),

    _uploadDidEnd: function ( event ) {
        var request = event.target;
        request.destroy();
        if ( this._request === request ) {
            this._request = null;
        }
    }.on( 'io:end' ),

    uploadDidSucceed: function () {
        this.fire( 'localfile:success' );
    },

    uploadDidFail: function () {
        this.fire( 'localfile:failure' );
    },
});

// --- Export

JMAP.LocalFile = LocalFile;

}( JMAP ) );
