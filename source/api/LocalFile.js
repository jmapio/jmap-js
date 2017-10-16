// -------------------------------------------------------------------------- \\
// File: LocalFile.js                                                         \\
// Module: API                                                                \\
// Requires: connections.js                                                   \\
// -------------------------------------------------------------------------- \\

/*global O, JMAP */

'use strict';

( function ( JMAP ) {

const LocalFile = O.Class({

    Extends: O.Object,

    nextEventTarget: JMAP.upload,

    init: function ( file ) {
        this.file = file;
        this.blobId = '';

        this.name = file.name ||
            ( 'image.' + ( /\w+$/.exec( file.type ) || [ 'png' ] )[0] );
        this.type = file.type;
        this.size = file.size;

        this.isTooBig = false;
        this.isUploaded = false;
        this.progress = 0;

        this._backoff = 500;

        LocalFile.parent.constructor.call( this );
    },

    destroy: function () {
        var request = this._request;
        if ( request ) {
            JMAP.upload.abort( request );
        }
        LocalFile.parent.destroy.call( this );
    },

    upload: function ( obj, key ) {
        if ( obj && key ) {
            obj.removeObserverForKey( key, this, 'upload' );
        }
        if ( !this.isDestroyed ) {
            JMAP.upload.send(
                this._request = new O.HttpRequest({
                    nextEventTarget: this,
                    method: 'POST',
                    url: JMAP.auth.get( 'uploadUrl' ),
                    headers: {
                        'Authorization':
                            'Bearer ' + JMAP.auth.get( 'accessToken' )
                    },
                    withCredentials: true,
                    data: this.file
                })
            );
        }
        return this;
    },

    _uploadDidProgress: function () {
        this.set( 'progress', this._request.get( 'uploadProgress' ) );
    }.on( 'io:uploadProgress' ),

    _uploadDidSucceed: function ( event ) {
        var response, property;

        // Parse response.
        try {
            response = JSON.parse( event.data );
        } catch ( error ) {}

        // Was there an error?
        if ( !response ) {
            return this.onFailure( event );
        }

        this.beginPropertyChanges();
        for ( property in response ) {
            // blobId, type, size, expires[, width, height]
            this.set( property, response[ property ] );
        }
        this.set( 'progress', 100 )
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
            JMAP.auth.didLoseAuthentication()
                     .addObserverForKey( 'isAuthenticated', this, 'upload' );
           break;
        case 404: // Not Found
            JMAP.auth.refindEndpoints()
                     .addObserverForKey( 'uploadUrl', this, 'upload' );
            break;
        case 413: // Request Entity Too Large
            this.set( 'isTooBig', true );
            break;
        default:  // Connection failed or 503 Service Unavailable
            O.RunLoop.invokeAfterDelay( this.upload, this._backoff, this );
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

    uploadDidSucceed: function () {},
    uploadDidFail: function () {}
});

JMAP.LocalFile = LocalFile;

}( JMAP ) );
