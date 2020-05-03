#pragma once

#include <device/Output.h>
#include <stdio.h>
#include <math.h>
#include <pigpio.h>
#include <thirdparty/json/single_include/nlohmann/json.hpp>
using json = nlohmann::json;

class OutputPWMpigpio : public Output
{
public:
    OutputPWMpigpio(const json &properties)
    {
        // check properties object contains PWM properties, and set defaults if not
        if (properties.contains("pin"))
        {
            _pinNumber = properties["pin"].get<unsigned>();
        }
        else
        {
            _pinNumber = 18;
            std::cout << "no gpio pin specified in properties, using default: " << _pinNumber << std::endl;
        }
        if (properties.contains("frequency"))
        {
            _frequency = properties["frequency"].get<unsigned>();
        }
        else
        {
            _frequency = 500;
            std::cout << "no pwm frequency specified in properties, using default: " << _frequency << std::endl;
        }
        //
        if (gpioInitialise() < 0)
        {
            std::cout << "pigpio initialisation failed" << std::endl;
            return;
        }
        else
        {
            std::cout << "initialised pigpio" << std::endl;
            if (gpioSetMode(_pinNumber, PI_OUTPUT) != 0) {
                std::cout << "error in gpio set mode" << std::endl;
            }
            std::cout << "PWM frequency: " << gpioSetPWMfrequency(_pinNumber, _frequency) << "Hz" << std::endl;
            gpioSetPWMrange(_pinNumber, 765); // range = 255 * 3
        }
        std::cout << "Opened PWM" << std::endl;
    };
    int write(const std::vector<ColorRgb> &ledValues)
    {
        // get colour (max speed is RANGE = 255 * 3)
        uint32_t data = 0;
        data += ledValues[0].red;
        data += ledValues[0].green;
        data += ledValues[0].blue;
        // send to PWM
        if(gpioPWM(_pinNumber, data) != 0) {
            std::cout << "pwm error" << std::endl;
        }
        return 0;
    }
    virtual ~OutputPWMpigpio()
    {
        // close
        gpioTerminate();
        std::cout << "Closed PWM" << std::endl;
    };
    unsigned _pinNumber = 18; // 0-31, a Broadcom numbered GPIO
    unsigned _frequency = 500; // frequency in Hz for gpio
};