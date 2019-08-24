#pragma GCC system_header
//#ifdef RPI
#include <bcm_host.h>
//#endif

// STL includes
#include <cstdint>
#include <cassert>
#include <iostream>

// Utils includes
#include <grabber/Image.h>
#include <grabber/ColorRgba.h>

class FrameGrabber
{
  public:
//#ifdef RPI
    /// Handle to the display that is being captured
    DISPMANX_DISPLAY_HANDLE_T _vc_display;

    /// Handle to the resource for storing the captured snapshot
    DISPMANX_RESOURCE_HANDLE_T _vc_resource;

    /// Rectangle of the captured resource that is transfered to user space
    VC_RECT_T _rectangle;
//#endif

    /// Flags (transforms) for creating snapshots
    int _vc_flags;

    /// With of the captured snapshot [pixels]
    unsigned _width;
    /// Height of the captured snapshot [pixels]
    unsigned _height;

    // the selected VideoMode
    // VideoMode _videoMode;

    // number of pixels to crop after capturing
    unsigned _cropLeft, _cropRight, _cropTop, _cropBottom;

    // temp buffer when capturing with unsupported pitch size or
    // when we need to crop the image
    ColorRgba *_captureBuffer;

    // size of the capture buffer in Pixels
    unsigned _captureBufferSize;

    // constructor
    FrameGrabber() :
//#ifdef RPI
                                                                _vc_display(0),
                                                                _vc_resource(0),
//#endif
                                                                _vc_flags(0),
                                                                // _videoMode(VIDEO_2D),
                                                                _cropLeft(0),
                                                                _cropRight(0),
                                                                _cropTop(0),
                                                                _cropBottom(0),
                                                                _captureBuffer(new ColorRgba[0]),
                                                                _captureBufferSize(0)
    {
//#ifdef RPI
        // Initiase BCM
        bcm_host_init();

        {
            // Check if the display can be opened and display the current resolution
            // Open the connection to the display
            _vc_display = vc_dispmanx_display_open(0);
            assert(_vc_display > 0);

            // Obtain the display information
            DISPMANX_MODEINFO_T vc_info;
            int result = vc_dispmanx_display_get_info(_vc_display, &vc_info);
            // Keep compiler happy in 'release' mode
            (void)result;
            assert(result == 0);

            _width = vc_info.width;
            _height = vc_info.height;
            std::cout << "DISPMANXGRABBER INFO: Display opened with resolution: " << _width << "x" << _height << std::endl;

            // Close the displaye
            vc_dispmanx_display_close(_vc_display);
        }

        // Create the resources for capturing image
        uint32_t vc_nativeImageHandle;
        _vc_resource = vc_dispmanx_resource_create(
            VC_IMAGE_RGBA32,
            _width,
            _height,
            &vc_nativeImageHandle);
        assert(_vc_resource);

        // Define the capture rectangle with the same size
        vc_dispmanx_rect_set(&_rectangle, 0, 0, _width, _height);

//#endif
    }
    // destructor
    ~FrameGrabber()
    {
        delete[] _captureBuffer;
//#ifdef RPI
        // Clean up resources
        vc_dispmanx_resource_delete(_vc_resource);

        // De-init BCM
        bcm_host_deinit();
//#endif
    }
    void setFlags(const int vc_flags)
    {
        _vc_flags = vc_flags;
    }

    // void setVideoMode(const VideoMode videoMode)
    // {
    //     _videoMode = videoMode;
    // }

    void setCropping(unsigned cropLeft, unsigned cropRight, unsigned cropTop, unsigned cropBottom)
    {
        if (cropLeft + cropRight >= _width || cropTop + cropBottom >= _height)
        {
            std::cout
                << "DISPMANXGRABBER ERROR: Rejecting invalid crop values"
                << " left: " << cropLeft
                << " right: " << cropRight
                << " top: " << cropTop
                << " bottom: " << cropBottom
                << std::endl;
            return;
        }
        _cropLeft = cropLeft;
        _cropRight = cropRight;
        _cropTop = cropTop;
        _cropBottom = cropBottom;

        if (cropLeft > 0 || cropRight > 0 || cropTop > 0 || cropBottom > 0)
        {
            std::cout
                << "DISPMANXGRABBER INFO: Cropping " << _width << "x" << _height << " image"
                << " left: " << cropLeft
                << " right: " << cropRight
                << " top: " << cropTop
                << " bottom: " << cropBottom
                << std::endl;
        }
    }
    void grabFrame(Image<ColorRgba> &image)
    {
        int ret;

        // vc_dispmanx_resource_read_data doesn't seem to work well
        // with arbitrary positions so we have to handle cropping by ourselves
        unsigned cropLeft = _cropLeft;
        unsigned cropRight = _cropRight;
        unsigned cropTop = _cropTop;
        unsigned cropBottom = _cropBottom;
//#ifdef RPI
        if (_vc_flags & DISPMANX_SNAPSHOT_FILL)
        {
            // disable cropping, we are capturing the video overlay window
            cropLeft = cropRight = cropTop = cropBottom = 0;
        }

        unsigned imageWidth = _width - cropLeft - cropRight;
        unsigned imageHeight = _height - cropTop - cropBottom;

        // // calculate final image dimensions and adjust top/left cropping in 3D modes
        // switch (_videoMode)
        // {
        // case VIDEO_3DSBS:
        //     imageWidth = imageWidth / 2;
        //     cropLeft = cropLeft / 2;
        //     break;
        // case VIDEO_3DTAB:
        //     imageHeight = imageHeight / 2;
        //     cropTop = cropTop / 2;
        //     break;
        // case VIDEO_2D:
        // default:
        //     break;
        // }

        // resize the given image if needed
        if (image.width() != imageWidth || image.height() != imageHeight)
        {
            image.resize(imageWidth, imageHeight);
        }

        // Open the connection to the display
        _vc_display = vc_dispmanx_display_open(0);
        if (_vc_display < 0)
        {
            std::cout << "DISPMANXGRABBER ERROR: Cannot open display: " << _vc_display << std::endl;
            return;
        }

        // Create the snapshot (incl down-scaling)
        ret = vc_dispmanx_snapshot(_vc_display, _vc_resource, (DISPMANX_TRANSFORM_T)_vc_flags);
        if (ret < 0)
        {
            std::cout << "DISPMANXGRABBER ERROR: Snapshot failed: " << ret << std::endl;
            vc_dispmanx_display_close(_vc_display);
            return;
        }

        // Read the snapshot into the memory
        void *imagePtr = image.memptr();
        void *capturePtr = imagePtr;

        unsigned imagePitch = imageWidth * sizeof(ColorRgba);

        // dispmanx seems to require the pitch to be a multiple of 64
        unsigned capturePitch = (_rectangle.width * sizeof(ColorRgba) + 63) & (~63);

        // grab to temp buffer if image pitch isn't valid or if we are cropping
        if (imagePitch != capturePitch || (unsigned)_rectangle.width != imageWidth || (unsigned)_rectangle.height != imageHeight)
        {
            // check if we need to resize the capture buffer
            unsigned captureSize = capturePitch * _rectangle.height / sizeof(ColorRgba);
            if (_captureBufferSize != captureSize)
            {
                delete[] _captureBuffer;
                _captureBuffer = new ColorRgba[captureSize];
                _captureBufferSize = captureSize;
            }

            capturePtr = &_captureBuffer[0];
        }

        ret = vc_dispmanx_resource_read_data(_vc_resource, &_rectangle, capturePtr, capturePitch);
        if (ret < 0)
        {
            std::cout << "DISPMANXGRABBER ERROR: vc_dispmanx_resource_read_data failed: " << ret << std::endl;
            vc_dispmanx_display_close(_vc_display);
            return;
        }

        // copy capture data to image if we captured to temp buffer
        if (imagePtr != capturePtr)
        {
            // adjust source pointer to top/left cropping
            uint8_t *src_ptr = (uint8_t *)capturePtr + cropLeft * sizeof(ColorRgba) + cropTop * capturePitch;

            for (unsigned y = 0; y < imageHeight; y++)
            {
                memcpy((uint8_t *)imagePtr + y * imagePitch,
                       src_ptr + y * capturePitch,
                       imagePitch);
            }
        }

        // Close the displaye
        vc_dispmanx_display_close(_vc_display);
//#endif
    }
};
