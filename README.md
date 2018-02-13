avconv -f x11grab -r 25 -s 1824x984 -i :0.0+0,0 -vcodec libx264 video.mkv

avconv -f x11grab -r 25 -s 1824x984 -i :0.0+0,0 -c:v libx264 -f mpegts udp://224.0.0.100:1234

uv4l --driver raspidisp --display 0 --framerate 30 --resolution 0 --auto-video_nr

g++ -o process_video process_v4l.cpp

v4l2-ctl --all -d /dev/video0

g++ opencv_test.cpp -o  opencv_test -I/usr/local/include/ -lopencv_core -lopencv_highgui -lopencv_imgproc

g++ -std=c++11 xscr.cpp -o  xscr -I/usr/local/include/ -lopencv_core -lopencv_highgui -lopencv_imgproc -L/usr/include/X11/lib -lX11

gcc -o capv4l2 capv4l2.c -I/usr/local/include/ -lopencv_core -lopencv_highgui -lopencv_imgproc -lm

resin sync --source . --destination /usr/src/

avconv -r 25 -s 1824x984 -f video4linux2 -i /dev/video0 udp://224.0.0.100:1234
