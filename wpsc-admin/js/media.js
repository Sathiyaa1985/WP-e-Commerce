/*global _, WPSC_Media, Backbone, alert, WPSC, wp, wpsc_refresh_variation_iframe, wpsc_set_variation_product_thumbnail, jQuery */
(function($) {
	"use strict";
	window.WPSC = window.WPSC || {};

	/**
	 * Inspired by Cocktail (https://github.com/onsi/cocktail/) but with some
	 * important modifications.
	 *
	 * Mixing an object into a class' prototype will make sure that object is
	 * extended from previous Mixins / oroginal prototype.
	 *
	 * Primitive values can also be mixed in.
	 *
	 * @param  {Object} object    The original object
	 * @param  {...Object} mixins Mixins
	 */
	window.WPSC.mixin = function( clss ) {
		var modules = _.rest( arguments );
		var chain = {};

		_.each( modules, function( module ) {
			var override = module._mixin_override || [];
			module = _.omit( module, [ '_mixin_override'] );

			_.each( module, function( value, key ) {
				if ( _.contains( override, key ) ) {
					chain[key] = [value];
					return;
				}

				if ( _.isFunction( value ) ) {
					if ( clss.prototype[key] )
						chain[key] = [clss.prototype[key]];

					chain[key].push( value );
				} else if ( _.isObject( value ) ) {
					chain[key] = chain[key] || [{}];
					if ( clss.prototype[key] )
						chain[key] = [clss.prototype[key]];

					chain[key].push( _.extend( {}, chain[key][0], value ) );
				} else {
					chain[key] = chain[key] || [];
					chain[key].push( value );
				}
			} );
		} );

		_.each( chain, function( values, key ) {
			var last = _.last( values );

			if ( ! _.isFunction( last ) ) {
				clss.prototype[key] = last;
				return;
			}

			clss.prototype[key] = function() {
				var ret, args = arguments, that = this;
				_.each( values, function( fn ) {
					var fnRet = fn.apply( that, args );
					ret =
						_.isUndefined( fnRet ) ?
						ret :
						fnRet;
				});

				return ret;
			};
		} );
	};

	var media = window.wp.media;

	var backup = _.clone( media.view.settings.post );

	media.controller.wpsc = {
		ProductGallery: media.controller.Library.extend({
			defaults: _.defaults({
				id           : 'wpsc-product-gallery',
				filterable   : 'uploaded',
				multiple     : 'add',
				toolbar      : 'wpsc-save-gallery',
				title        : WPSC_Media.l10n.productMediaTitle,
				priority     : 50,
				library      : media.query( { type: 'image' } ),
				syncSelection: false
			}, media.controller.Library.prototype.defaults ),

			initialize: function( options ) {
				var selection = new media.model.wpsc.ProductGallerySelection(
					[],
					{
						postId: media.model.settings.post.id,
						multiple: this.get( 'multiple' ),
						nonce: options.nonce || WPSC_Media.updateGalleryNonce
					}
				);
				this.set(
					'selection',
					selection
				);

				var models = options.models || WPSC_Media.gallery;

				// work around for backbone.js 0.9.2
				if ( _.isUndefined( Backbone.Collection.prototype.set ) ) {
					// force parse the response
					models = selection.parse( models );
					selection.reset( models );
				} else {
					selection.set( models, { parse: true } );
				}

				media.controller.Library.prototype.initialize.apply( this, arguments );

				this.on( 'select', function() {
					selection.save_gallery();
				} );

				this.get( 'library' ).observe( selection );
			}
		})
	};

	media.model.wpsc = {
		ProductGallerySelection: media.model.Selection.extend( {
			initialize: function( models, options ) {
				media.model.Selection.prototype.initialize.apply( this, [models, options] );
				this.postId = options && options.postId;
				this.nonce = options.nonce || WPSC_Media.updateGalleryNonce;
			},

			save_gallery: function( options ) {
				options = _.extend( options || {}, {
					data: {
						items: this.pluck( 'id' )
					},
					success: function( resp, status, xhr ) {
						// in case of backbone 0.9.2
						if ( _.isUndefined( this.set ) ) {
							// force parse the response
							resp.obj = this.parse( resp.obj, xhr );
							this.reset( resp.obj );
						} else {
							this.set( resp.obj, { parse: true } );
						}
					},
					error: function( resp ) {
						alert( resp.error.messages.join( "\n" ) );
					}
				} );
				this.sync( 'update', this, options );
			},

			sync: function( method, collection, options ) {
				var data;

				options = options ? _.clone( options ) : {};

				options.success = _.bind( options.success, this );
				options.error   = _.bind( options.error, this );

				switch (method) {
					case 'read':
						break;

					case 'update':
						options.data = options.data || {};
						data = _.defaults( {
							action: 'save_product_gallery',
							nonce : this.nonce,
							items : this.pluck( 'id' ),
							postId: this.postId
						}, options.data );

						$.wpsc_post( data ).done( function( resp, status, xhr ) {
							if ( resp.is_successful ) {
								options.success( resp, status, xhr );
							}
							else {
								options.error( resp, status, xhr );
							}
						} );

						break;

					case 'create':
					case 'delete':
						// do nothing for now
						break;
				}
			}
		} )
	};

	media.view.wpsc = {
	};

	/**
	 * Extend the MediaFrame.Post class so that we can inject a custom tab
	 * dynamically using JavaScript.
	 */
	WPSC.mixin(
		media.view.MediaFrame.Post,
		{
			wpsc: {
				saveGalleryStatusBar: function( view ) {
					this.selectionStatusToolbar(view);
				},
				saveGalleryToolbar: function( toolbar ) {
					this.createSelectToolbar( toolbar, {
						text : WPSC_Media.l10n.saveGallery,
						state: this.options.state
					} );
				},
				createStates: function() {
					this.states.add( new media.controller.wpsc.ProductGallery( { models: this.options.models, nonce: this.options.nonce } ) );
				},
				bindHandlers: function() {
					this.on( 'toolbar:create:wpsc-save-gallery', this.wpsc.saveGalleryToolbar, this );
					this.on( 'toolbar:render:wpsc-save-gallery', this.wpsc.saveGalleryStatusBar, this );
				}
			},

			initialize: function() {
				if ( ! this.options.models )
					this.options.models = WPSC_Media.gallery;

				if ( ! this.options.nonce )
					this.options.nonce = WPSC_Media.updateGalleryNonce;
				this.wpsc.createStates.apply( this );
				this.wpsc.bindHandlers.apply( this );
			}
		}
	);

	/**
	 * Extend media.view.Attachment
	 */
	WPSC.mixin(
		media.view.Attachment,
		{
			render: function() {
				if ( this.controller.state().id != 'wpsc-product-gallery' )
					return;

				if ( this.model.id != media.view.settings.post.featuredImageId )
					return;

				this.$el.find( '.thumbnail' ).append('<span class="wpsc-featured-label">featured</span>');
			}
		}
	);

	WPSC_Media.open = function( options ) {
		var workflow;

		media.view.settings.post.id = options.id;
		media.view.settings.post.featuredImageId = options.featuredId;
		media.view.settings.post.nonce = options.featuredNonce;
		media.model.settings.post = media.view.settings.post;
		media.editor.remove( 'wpsc-variation-media' );
		media.editor.add( 'wpsc-variation-media', {
			models: options.models,
			nonce: options.galleryNonce
		});
		workflow = media.editor.open( 'wpsc-variation-media' );
	};

	var oldEditorOpen = media.editor.open;
	media.editor.open = function( id ) {
		if ( id == 'content' ) {
			media.view.settings.post = _.clone( backup );
			media.model.settings.post = media.view.settings.post;
		}
		return oldEditorOpen.apply( this, arguments );
	};

	// hack the set featured image function
	wp.media.featuredImage.set = function( id ) {
		var settings = wp.media.view.settings;
		var currentId = settings.post.id;

		wp.media.post( 'set-post-thumbnail', {
			json:         true,
			post_id:      settings.post.id,
			thumbnail_id: id,
			_wpnonce:     settings.post.nonce
		}).done( function( html ) {
			if ( settings.post.id == backup.id ) {
				wpsc_refresh_variation_iframe();
				$( '.inside', '#postimagediv' ).html( html );
			} else {
				wpsc_set_variation_product_thumbnail( currentId, $( html ).find( 'img' ).attr( 'src' ), id );
			}
		});
	};
}(jQuery));